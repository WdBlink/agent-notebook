#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifdef __APPLE__
#include <libproc.h>
#include <sys/sysctl.h>
#include <sys/types.h>

static int process_has_token(pid_t pid, const char *needle, size_t needle_len, int prefix_match) {
  int mib[] = { CTL_KERN, KERN_PROCARGS2, pid };
  int argmax_mib[] = { CTL_KERN, KERN_ARGMAX };
  int argmax = 0;
  size_t argmax_size = sizeof(argmax);
  if (sysctl(argmax_mib, 2, &argmax, &argmax_size, NULL, 0) != 0 || argmax <= 0) return 0;
  size_t size = (size_t)argmax;
  char *buffer = malloc(size);
  if (buffer == NULL) return 0;
  if (sysctl(mib, 3, buffer, &size, NULL, 0) != 0) {
    free(buffer);
    return 0;
  }
  int found = 0;
  for (size_t offset = 0; offset + needle_len <= size; offset++) {
    if (memcmp(buffer + offset, needle, needle_len) == 0
        && (offset == 0 || buffer[offset - 1] == '\0')
        && (prefix_match || offset + needle_len == size || buffer[offset + needle_len] == '\0')) {
      found = 1;
      break;
    }
  }
  memset(buffer, 0, size);
  free(buffer);
  return found;
}

static int scan_processes(const char *needle, size_t needle_len, int prefix_match) {
  int capacity = proc_listallpids(NULL, 0);
  if (capacity <= 0) return 21;
  capacity += 128;
  pid_t *processes = calloc((size_t)capacity, sizeof(pid_t));
  if (processes == NULL) return 22;
  int count = proc_listallpids(processes, capacity * (int)sizeof(pid_t));
  if (count <= 0) {
    free(processes);
    return 23;
  }
  for (int index = 0; index < count; index++) {
    pid_t pid = processes[index];
    struct proc_bsdinfo info;
    int info_size = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info));
    if (info_size == sizeof(info) && info.pbi_uid == getuid()
        && pid > 1 && pid != getpid() && process_has_token(pid, needle, needle_len, prefix_match)) {
      printf("%d\n", pid);
    }
  }
  free(processes);
  return ferror(stdout) ? 24 : 0;
}
#else
#include <dirent.h>
#include <ctype.h>

static int scan_processes(const char *needle, size_t needle_len, int prefix_match) {
  DIR *directory = opendir("/proc");
  if (directory == NULL) return 2;
  struct dirent *entry;
  while ((entry = readdir(directory)) != NULL) {
    if (!isdigit((unsigned char)entry->d_name[0])) continue;
    pid_t pid = (pid_t)strtol(entry->d_name, NULL, 10);
    if (pid <= 1 || pid == getpid()) continue;
    char path[64];
    snprintf(path, sizeof(path), "/proc/%d/environ", pid);
    FILE *file = fopen(path, "rb");
    if (file == NULL) continue;
    char *entry_value = NULL;
    size_t capacity = 0;
    while (getdelim(&entry_value, &capacity, '\0', file) != -1) {
      size_t length = strlen(entry_value);
      if ((prefix_match ? length >= needle_len : length == needle_len) && memcmp(entry_value, needle, needle_len) == 0) {
        printf("%d\n", pid);
        break;
      }
    }
    if (entry_value != NULL) {
      memset(entry_value, 0, capacity);
      free(entry_value);
    }
    fclose(file);
  }
  closedir(directory);
  return ferror(stdout) ? 2 : 0;
}
#endif

int main(void) {
  const char *key = getenv("AGENT_NOTEBOOK_AUDIT_KEY");
  const char *value = getenv("AGENT_NOTEBOOK_AUDIT_VALUE");
  if (key == NULL || value == NULL || key[0] == '\0' || value[0] == '\0' || strchr(key, '=') != NULL) return 2;
  int prefix_match = strcmp(value, "*") == 0;
  size_t length = strlen(key) + (prefix_match ? 0 : strlen(value)) + 2;
  char *needle = malloc(length);
  if (needle == NULL) return 2;
  if (prefix_match) snprintf(needle, length, "%s=", key);
  else snprintf(needle, length, "%s=%s", key, value);
  int result = scan_processes(needle, strlen(needle), prefix_match);
  memset(needle, 0, length);
  free(needle);
  return result;
}
