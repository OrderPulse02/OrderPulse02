// Picks the backend: real Supabase (live) or the built-in demo (this browser only).
let __opImpl;
async function getApi() {
  if (!__opImpl) __opImpl = DEMO ? createDemoBackend() : createSupabaseBackend(CONFIG);
  return __opImpl;
}
