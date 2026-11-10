export const SUPABASE_AUTH_COOKIE_NAME = "work-instructions-auth-token";

/**
 * SQLSTATE our database functions raise when a record changed after the user opened it.
 * PostgREST answers PTxyz codes with HTTP xyz immediately. Never use 40001 for this: PostgREST
 * treats it as a transient serialization failure and retries the call until the gateway times out.
 */
export const STALE_RECORD_ERROR_CODE = "PT409";
