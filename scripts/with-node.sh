#!/bin/sh
# Use this launcher from GUI tools and shells that did not load NVM themselves.
set -eu

if [ "$#" -eq 0 ]; then
  printf '%s\n' 'Usage: ./scripts/with-node.sh <command> [arguments...]' >&2
  exit 2
fi

task_script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
task_project_directory=$(CDPATH= cd -- "$task_script_directory/.." && pwd)
cd "$task_project_directory"
task_node_version=$(tr -d ' \r\n' < .nvmrc)
task_node_major=${task_node_version%%.*}
task_node_actual=$(node --version 2>/dev/null || true)

if [ "$task_node_actual" != "v$task_node_version" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  task_nvm_script="$NVM_DIR/nvm.sh"
  if [ -s "$task_nvm_script" ]; then
    # NVM supports POSIX shells; loading it without switching avoids a default
    # alias temporarily selecting the wrong version.
    . "$task_nvm_script" --no-use
    if ! nvm use --silent "$task_node_version"; then
      printf '%s\n' "Node $task_node_version is not installed. Run nvm install from this project, then retry." >&2
      exit 1
    fi
  fi
fi

task_node_actual=$(node --version 2>/dev/null || true)
case "$task_node_actual" in
  "v$task_node_major."*) ;;
  *)
    printf '%s\n' "Node $task_node_major is required; found ${task_node_actual:-no Node installation}. Install the version in .nvmrc, then retry." >&2
    exit 1
    ;;
esac

task_package_manager=$(node -p "require('./package.json').packageManager")
case "$task_package_manager" in
  npm@*) task_npm_version=${task_package_manager#npm@} ;;
  *) printf '%s\n' 'The project must declare an exact npm packageManager version.' >&2; exit 1 ;;
esac
task_npm_actual=$(npm --version 2>/dev/null || true)
if [ "$task_npm_actual" != "$task_npm_version" ]; then
  printf '%s\n' "npm $task_npm_version is required; found ${task_npm_actual:-no npm installation}. Run node scripts/install-toolchain.mjs, then retry." >&2
  exit 1
fi

exec "$@"
