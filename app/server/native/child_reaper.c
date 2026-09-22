/* Linux child-subreaper helpers for the server process.
 *
 * Rebuild (Node headers required):
 *   gcc -shared -fPIC -DNODE_GYP_MODULE_NAME=child_reaper -I"$NODE_INCLUDE" \
 *     -o app/server/native/child_reaper.node \
 *     app/server/native/child_reaper.c
 */

#define BUILDING_NODE_EXTENSION
#include <node_api.h>

#include <errno.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/wait.h>

static napi_value SetChildSubreaper(napi_env env, napi_callback_info info) {
  (void)info;
  if (prctl(PR_SET_CHILD_SUBREAPER, 1L, 0L, 0L, 0L) != 0) {
    napi_throw_error(env, NULL, strerror(errno));
    return NULL;
  }
  napi_value undefined_value;
  napi_get_undefined(env, &undefined_value);
  return undefined_value;
}

/* waitpid(pid, WNOHANG). Null when the pid is not a waitable child. */
static napi_value WaitPid(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  int32_t pid = -1;
  int32_t flags = WNOHANG;
  if (argc >= 1) napi_get_value_int32(env, args[0], &pid);
  if (argc >= 2) napi_get_value_int32(env, args[1], &flags);

  int status = 0;
  pid_t got;
  do {
    got = waitpid((pid_t)pid, &status, flags);
  } while (got < 0 && errno == EINTR);

  if (got <= 0) {
    if (got < 0 && errno != ECHILD) {
      napi_throw_error(env, NULL, strerror(errno));
      return NULL;
    }
    napi_value null_value;
    napi_get_null(env, &null_value);
    return null_value;
  }

  napi_value obj;
  napi_value vpid;
  napi_create_object(env, &obj);
  napi_create_int32(env, (int32_t)got, &vpid);
  napi_set_named_property(env, obj, "pid", vpid);
  return obj;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value set_fn;
  napi_value wait_fn;
  napi_value wnohang;
  napi_create_function(env, "setChildSubreaper", NAPI_AUTO_LENGTH,
                       SetChildSubreaper, NULL, &set_fn);
  napi_create_function(env, "waitPid", NAPI_AUTO_LENGTH, WaitPid, NULL,
                       &wait_fn);
  napi_create_int32(env, WNOHANG, &wnohang);
  napi_set_named_property(env, exports, "setChildSubreaper", set_fn);
  napi_set_named_property(env, exports, "waitPid", wait_fn);
  napi_set_named_property(env, exports, "WNOHANG", wnohang);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
