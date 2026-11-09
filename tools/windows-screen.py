"""Windows desktop input and screenshots for the private PS5 Pro MCP helper."""

import ctypes
import json
import sys
import threading
import time
from ctypes import wintypes
from pathlib import Path

from PIL import ImageGrab
import pytesseract
import win32clipboard
import win32gui


user32 = ctypes.windll.user32
PAUSED_FILE = Path(__file__).resolve().parent.parent / ".ps5-screen-paused"
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except (AttributeError, OSError):
    user32.SetProcessDPIAware()


class KeyboardInput(ctypes.Structure):
    _fields_ = [
        ("key", wintypes.WORD),
        ("scan", wintypes.WORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("extra", ctypes.c_void_p),
    ]


class MouseInput(ctypes.Structure):
    _fields_ = [
        ("x", wintypes.LONG),
        ("y", wintypes.LONG),
        ("data", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("extra", ctypes.c_void_p),
    ]


class InputUnion(ctypes.Union):
    _fields_ = [("keyboard", KeyboardInput), ("mouse", MouseInput)]


class Input(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("value", InputUnion)]


user32.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(Input), ctypes.c_int]
user32.SendInput.restype = wintypes.UINT
user32.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
user32.SetCursorPos.restype = wintypes.BOOL
user32.GetParent.argtypes = [wintypes.HWND]
user32.GetParent.restype = wintypes.HWND
user32.SetWindowDisplayAffinity.argtypes = [wintypes.HWND, wintypes.DWORD]
user32.SetWindowDisplayAffinity.restype = wintypes.BOOL
user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
user32.GetWindowLongW.restype = wintypes.LONG
user32.SetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.LONG]
user32.SetWindowLongW.restype = wintypes.LONG
user32.MoveWindow.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_int,
                              ctypes.c_int, ctypes.c_int, wintypes.BOOL]
user32.MoveWindow.restype = wintypes.BOOL


class Rect(ctypes.Structure):
    _fields_ = [("left", wintypes.LONG), ("top", wintypes.LONG),
                ("right", wintypes.LONG), ("bottom", wintypes.LONG)]


class MonitorInfo(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("monitor", Rect),
                ("work", Rect), ("flags", wintypes.DWORD)]


MonitorCallback = ctypes.WINFUNCTYPE(wintypes.BOOL, ctypes.c_void_p,
                                      ctypes.c_void_p, ctypes.POINTER(Rect),
                                      ctypes.c_ssize_t)
user32.EnumDisplayMonitors.argtypes = [ctypes.c_void_p, ctypes.c_void_p,
                                        MonitorCallback, ctypes.c_ssize_t]
user32.GetMonitorInfoW.argtypes = [ctypes.c_void_p, ctypes.POINTER(MonitorInfo)]
user32.RegisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int,
                                   wintypes.UINT, wintypes.UINT]


def monitors():
    found = []

    def add_monitor(handle, _dc, _rect, _data):
        info = MonitorInfo()
        info.size = ctypes.sizeof(MonitorInfo)
        if user32.GetMonitorInfoW(handle, ctypes.byref(info)):
            rect = info.monitor
            found.append({"x": rect.left, "y": rect.top,
                          "width": rect.right - rect.left,
                          "height": rect.bottom - rect.top,
                          "primary": bool(info.flags & 1)})
        return True

    callback = MonitorCallback(add_monitor)
    if not user32.EnumDisplayMonitors(None, None, callback, 0):
        raise RuntimeError("Could not list Windows monitors")
    found.sort(key=lambda item: (not item["primary"], item["x"], item["y"]))
    for index, item in enumerate(found):
        item["index"] = index
    return found


def send(inputs):
    events = (Input * len(inputs))(*inputs)
    count = user32.SendInput(len(events), events, ctypes.sizeof(Input))
    if count != len(events):
        raise RuntimeError(f"Windows accepted {count}/{len(events)} input events; elevated apps may block input")


def key_event(code, up=False, unicode=False):
    flags = (0x0004 if unicode else 0) | (0x0002 if up else 0)
    return Input(type=1, value=InputUnion(keyboard=KeyboardInput(0 if unicode else code, code if unicode else 0, flags, 0, None)))


def mouse_event(flags, data=0):
    return Input(type=0, value=InputUnion(mouse=MouseInput(0, 0, data & 0xFFFFFFFF, flags, 0, None)))


def set_cursor(x, y):
    if not user32.SetCursorPos(int(x), int(y)):
        raise RuntimeError("Windows could not move the cursor")


def top_window_at(x, y):
    handle = win32gui.WindowFromPoint((int(x), int(y)))
    return win32gui.GetAncestor(handle, 2) if handle else 0


def foreground_window():
    handle = win32gui.GetForegroundWindow()
    return win32gui.GetAncestor(handle, 2) if handle else 0


def activate_window(title, x=None, y=None):
    matches = []
    win32gui.EnumWindows(
        lambda handle, _: matches.append(handle)
        if win32gui.IsWindowVisible(handle) and win32gui.GetWindowText(handle) == title
        else None, None)
    if len(matches) != 1:
        raise RuntimeError(f"Expected one visible window titled {title!r}; found {len(matches)}")
    handle = matches[0]
    if win32gui.IsIconic(handle):
        win32gui.ShowWindow(handle, 9)  # SW_RESTORE
    left, top, right, bottom = win32gui.GetWindowRect(handle)
    if x is not None and not (left <= x < right and top <= y < bottom):
        raise RuntimeError("Click coordinates are outside the named window; capture again")
    check_x = x if x is not None else (left + right) // 2
    check_y = y if y is not None else (top + bottom) // 2
    if foreground_window() != handle:
        try:
            win32gui.SetForegroundWindow(handle)
        except win32gui.error:
            pass
        if foreground_window() != handle:
            send([key_event(0x12), key_event(0x12, up=True)])
            win32gui.SetForegroundWindow(handle)
    for _ in range(10):
        if foreground_window() == handle and top_window_at(check_x, check_y) == handle:
            return handle
        time.sleep(0.1)
    raise RuntimeError("The named window did not come to the foreground at the click point; no click was sent")


def type_text(value):
    previous = []
    win32clipboard.OpenClipboard()
    try:
        format_id = 0
        while format_id := win32clipboard.EnumClipboardFormats(format_id):
            data = win32clipboard.GetClipboardData(format_id)
            if not isinstance(data, (str, bytes)):
                raise RuntimeError("Cannot safely preserve the current clipboard; text was not pasted")
            previous.append((format_id, data))
    finally:
        win32clipboard.CloseClipboard()
    win32clipboard.OpenClipboard()
    try:
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardData(win32clipboard.CF_UNICODETEXT, value)
    finally:
        win32clipboard.CloseClipboard()
    try:
        key_combo("Ctrl+V")
        time.sleep(0.6)
    finally:
        win32clipboard.OpenClipboard()
        try:
            win32clipboard.EmptyClipboard()
            for format_id, data in previous:
                win32clipboard.SetClipboardData(format_id, data)
        finally:
            win32clipboard.CloseClipboard()


KEYS = {
    "ctrl": 0x11, "control": 0x11, "shift": 0x10, "alt": 0x12,
    "win": 0x5B, "enter": 0x0D, "return": 0x0D, "esc": 0x1B,
    "escape": 0x1B, "tab": 0x09, "space": 0x20, "backspace": 0x08,
    "delete": 0x2E, "home": 0x24, "end": 0x23, "pageup": 0x21,
    "pagedown": 0x22, "up": 0x26, "down": 0x28, "left": 0x25,
    "right": 0x27,
}
KEYS.update({f"f{n}": 0x6F + n for n in range(1, 13)})


def key_combo(value):
    names = [part.strip().lower() for part in value.split("+")]
    codes = []
    for name in names:
        if len(name) == 1 and name.isascii() and name.isalnum():
            codes.append(ord(name.upper()))
        elif name in KEYS:
            codes.append(KEYS[name])
        else:
            raise ValueError(f"Unsupported key: {name}")
    if not codes:
        raise ValueError("Missing key")
    send([key_event(code) for code in codes] + [key_event(code, up=True) for code in reversed(codes)])


def capture(request):
    region = request.get("region")
    monitor = request.get("monitor")
    if monitor is not None:
        options = monitors()
        if not isinstance(monitor, int) or monitor < 0 or monitor >= len(options):
            raise ValueError("Unknown monitor index; call screen_monitors first")
        region = options[monitor]
    if region:
        left = int(region["x"])
        top = int(region["y"])
        width = int(region["width"])
        height = int(region["height"])
        if width < 1 or height < 1 or width * height > 16_000_000:
            raise ValueError("Screen region has invalid dimensions")
        image = ImageGrab.grab(bbox=(left, top, left + width, top + height), all_screens=True)
    elif request.get("scope") == "all":
        left, top = user32.GetSystemMetrics(76), user32.GetSystemMetrics(77)
        image = ImageGrab.grab(all_screens=True)
    else:
        left, top = 0, 0
        image = ImageGrab.grab(all_screens=False)
    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    lines = {}
    for index, word in enumerate(data["text"]):
        word = word.strip()
        if not word or float(data["conf"][index]) < 20:
            continue
        key = (data["block_num"][index], data["par_num"][index],
               data["line_num"][index])
        item = lines.setdefault(key, {"text": [], "x": left + data["left"][index],
                                      "y": top + data["top"][index],
                                      "right": left + data["left"][index] + data["width"][index],
                                      "bottom": top + data["top"][index] + data["height"][index]})
        item["text"].append(word)
        item["x"] = min(item["x"], left + data["left"][index])
        item["y"] = min(item["y"], top + data["top"][index])
        item["right"] = max(item["right"], left + data["left"][index] + data["width"][index])
        item["bottom"] = max(item["bottom"], top + data["top"][index] + data["height"][index])
    visible_text = [{"text": " ".join(item["text"]), "x": item["x"],
                     "y": item["y"], "width": item["right"] - item["x"],
                     "height": item["bottom"] - item["y"]}
                    for item in lines.values()]
    visible_text.sort(key=lambda item: (item["y"], item["x"]))

    visible_windows = []
    def add_window(handle, _data):
        if not win32gui.IsWindowVisible(handle):
            return
        title = win32gui.GetWindowText(handle)
        if not title or title == "PS5 PRO OPERATOR - SCREEN CONTROL ACTIVE":
            return
        x1, y1, x2, y2 = win32gui.GetWindowRect(handle)
        if x2 <= left or y2 <= top or x1 >= left + image.width or y1 >= top + image.height:
            return
        entry = {"title": title, "x": x1, "y": y1,
                 "width": x2 - x1, "height": y2 - y1,
                 "foreground": handle == foreground_window(),
                 "frontmostAtCenter": handle == top_window_at((x1 + x2) // 2, (y1 + y2) // 2)}
        children = []
        def add_child(child, _data):
            if len(children) >= 12 or not win32gui.IsWindowVisible(child):
                return
            cx1, cy1, cx2, cy2 = win32gui.GetWindowRect(child)
            if cx2 <= cx1 or cy2 <= cy1:
                return
            children.append({"class": win32gui.GetClassName(child),
                             "text": win32gui.GetWindowText(child)[:100],
                             "x": cx1, "y": cy1,
                             "width": cx2 - cx1, "height": cy2 - cy1})
        win32gui.EnumChildWindows(handle, add_child, None)
        if children:
            entry["controls"] = children
        visible_windows.append(entry)
    win32gui.EnumWindows(add_window, None)
    return {
        "originX": left,
        "originY": top,
        "width": image.width,
        "height": image.height,
        "foregroundWindow": win32gui.GetWindowText(foreground_window()),
        "text": visible_text[:100],
        "windows": visible_windows[:12],
    }


def overlay():
    import tkinter as tk

    root = tk.Tk()
    root.withdraw()
    labels = []

    def stop_control():
        PAUSED_FILE.write_text("Screen control stopped by user\n", encoding="utf-8")
        for label in labels:
            label.configure(text="SCREEN CONTROL STOPPED · USE DESKTOP RESUME ICON", fg="#ffffff")
        root.after(2500, root.destroy)

    for monitor in monitors():
        window = tk.Toplevel(root)
        window.title("PS5 PRO OPERATOR - SCREEN CONTROL ACTIVE")
        window.overrideredirect(True)
        window.attributes("-topmost", True)
        window.attributes("-alpha", 0.76)
        window.configure(bg="#ffca28")
        scale = min(2.5, max(1.0, monitor["height"] / 1080))
        width = min(monitor["width"] - 20, round(620 * scale))
        height = round(58 * scale)
        window.geometry(f"{width}x{height}+0+0")
        panel = tk.Frame(window, bg="#111318")
        panel.pack(fill="both", expand=True,
                   padx=round(3 * scale), pady=round(3 * scale))
        label = tk.Label(panel,
                         text="●  PS5 PRO OPERATOR  ·  CTRL+ALT+ESC TO STOP",
                         bg="#111318", fg="#ffca28",
                         font=("Arial", -round(18 * scale), "bold"),
                         padx=round(10 * scale))
        label.pack(side="left", fill="both", expand=True)
        button = tk.Button(panel, text="STOP", command=stop_control,
                           bg="#d62728", fg="white", activebackground="#a31d1f",
                           font=("Arial", -round(18 * scale), "bold"),
                           relief="flat", padx=round(14 * scale))
        button.pack(side="right", fill="y")
        window.update()
        handle = user32.GetParent(window.winfo_id()) or window.winfo_id()
        x = monitor["x"] + max(10, monitor["width"] - width - 20)
        y = monitor["y"] + 12
        user32.MoveWindow(handle, x, y, width, height, True)
        user32.SetWindowDisplayAffinity(handle, 0x11)
        labels.append(label)

    stopped = threading.Event()

    def hotkey_loop():
        if not user32.RegisterHotKey(None, 1, 0x0001 | 0x0002, 0x1B):
            return
        message = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
            if message.message == 0x0312 and message.wParam == 1:
                stopped.set()
                break
        user32.UnregisterHotKey(None, 1)

    threading.Thread(target=hotkey_loop, daemon=True).start()

    def check_hotkey():
        if stopped.is_set():
            stop_control()
        else:
            root.after(100, check_hotkey)

    root.after(100, check_hotkey)
    root.mainloop()


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "overlay":
        overlay()
        return
    request = json.load(sys.stdin)
    action = request.get("action")
    if action == "monitors":
        print(json.dumps({"monitors": monitors()}, separators=(",", ":")))
        return
    if PAUSED_FILE.exists():
        raise RuntimeError("Screen control was stopped on the laptop. Use the Resume PS5 Screen Control desktop shortcut.")
    if action == "capture" and request.get("activate_window_title"):
        activate_window(request["activate_window_title"])
    elif action == "click":
        if request.get("window_title"):
            target = activate_window(request["window_title"], request["x"], request["y"])
        else:
            target = top_window_at(request["x"], request["y"])
            if not target or target != foreground_window():
                raise RuntimeError("Click target is not the foreground window; provide its exact window_title")
        set_cursor(request["x"], request["y"])
        if top_window_at(request["x"], request["y"]) != target or foreground_window() != target:
            raise RuntimeError("Another window covers the click target; no click was sent")
        down, up = (0x0002, 0x0004) if request.get("button", "left") == "left" else (0x0008, 0x0010)
        for _ in range(request.get("count", 1)):
            send([mouse_event(down), mouse_event(up)])
            time.sleep(0.1)
    elif action == "type":
        if not request.get("expectedHandle") or foreground_window() != request["expectedHandle"]:
            raise RuntimeError("The target window lost focus; no text was sent. Capture and click it again")
        type_text(request["text"])
    elif action == "key":
        if not request.get("expectedHandle") or foreground_window() != request["expectedHandle"]:
            raise RuntimeError("The target window lost focus; no key was sent. Capture and click it again")
        key_combo(request["keys"])
    elif action == "scroll":
        if not request.get("expectedHandle") or foreground_window() != request["expectedHandle"] or top_window_at(request["x"], request["y"]) != request["expectedHandle"]:
            raise RuntimeError("The target window is not in front at the scroll point; capture and click it again")
        set_cursor(request["x"], request["y"])
        send([mouse_event(0x0800, request["steps"] * 120)])
    elif action != "capture":
        raise ValueError(f"Unsupported screen action: {action}")
    if action != "capture":
        time.sleep(0.3)
    result = capture(request)
    if action == "click":
        result["activeHandle"] = target
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
