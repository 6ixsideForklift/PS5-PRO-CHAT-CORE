const { createSupabaseAuthHandlers, getBalanceConfig } = require('@librechat/api');
const {
  findBalanceByUser,
  findUser,
  createUserIfAbsent,
  countUsers,
  deleteAllUserSessions,
} = require('~/models');
const { getAppConfig } = require('~/server/services/Config');
const { registerSchema } = require('~/strategies/validators');

const supabaseAuth =
  process.env.SUPABASE_AUTH_URL && process.env.SUPABASE_AUTH_PUBLISHABLE_KEY
    ? createSupabaseAuthHandlers({
        url: process.env.SUPABASE_AUTH_URL,
        publishableKey: process.env.SUPABASE_AUTH_PUBLISHABLE_KEY,
        getAppConfig,
        getBalanceConfig,
        findUser,
        createUserIfAbsent,
        findBalanceByUser,
        countUsers,
        deleteAllUserSessions,
        registrationSchema: registerSchema,
      })
    : null;

module.exports = supabaseAuth;
