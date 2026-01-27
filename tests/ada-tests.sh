#!/usr/bin/env bash
# ada-tests.sh v1 
#
# Location (new):
#   ./ada/tests/ada-tests.sh
#
# Secrets location (outside repo, one level above ./ada):
#   ./ada-tests.secrets.sh   <-- secrets (NOT committed)
#
# Logs location (outside repo, same folder as secrets by default):
#   ./ada-tests.log
#   ./ada-tests.transcripts/
#
# Run from anywhere:
#   bash ./ada/tests/ada-tests.sh                 # interactive menu
#   bash ./ada/tests/ada-tests.sh smoke           # direct command (also logged)
#   MODE=REAL STRICT_ON=1 bash ./ada/tests/ada-tests.sh smoke
#
# Optional env:
#   ADA_TESTS_PAUSE=1       # always pause at end of command (anti-close)
#   ADA_TESTS_NO_PAUSE=1    # never pause (override)
#
set -euo pipefail

# ---------------------- Defaults ----------------------
DEFAULT_LOCAL_PORT="4173"
DEFAULT_DEPLOY_URL="https://abupet.github.io/ada/"
DEFAULT_STRICT_ALLOW_HOSTS="cdnjs.cloudflare.com"
# ------------------------------------------------------

# Script is inside repo: <repo>/tests
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR_DEFAULT="$(cd "$SCRIPT_DIR/.." && pwd)"            # <repo>
OUT_DIR_DEFAULT="$(cd "$REPO_DIR_DEFAULT/.." && pwd)"       # parent folder of repo (where secrets live)

REPO_DIR="${REPO_DIR:-"$REPO_DIR_DEFAULT"}"
OUT_DIR="${OUT_DIR:-"$OUT_DIR_DEFAULT"}"

LOG_FILE="$OUT_DIR/ada-tests.log"
TRANSCRIPTS_DIR="$OUT_DIR/ada-tests.transcripts"

PORT="${PORT:-$DEFAULT_LOCAL_PORT}"
LOCAL_URL="${LOCAL_URL:-"http://localhost:${PORT}/index.html"}"
DEPLOY_URL="${DEPLOY_URL:-$DEFAULT_DEPLOY_URL}"

# -------------------- Load secrets --------------------
# Default secrets file is OUTSIDE the repo, next to the ./ada folder
SECRETS_FILE="${SECRETS_FILE:-"$OUT_DIR/ada-tests.secrets.sh"}"
if [[ -f "$SECRETS_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$SECRETS_FILE"
else
  echo "⚠️  Secrets file not found: $SECRETS_FILE"
  echo "   Create it one level above ./ada (same folder as ada-tests.log) with:"
  echo "   export ADA_TEST_PASSWORD=\"...\""
  echo "   (Optional) export DEPLOY_URL=\"https://abupet.github.io/ada/\""
fi
# ------------------------------------------------------

# ---------------------- UI colors (NO background changes) ----------------------
CLR_RESET=$'\e[0m'
CLR_RED=$'\e[31m'
CLR_GREEN=$'\e[32m'
CLR_YELLOW=$'\e[33m'
CLR_CYAN=$'\e[36m'
CLR_DIM=$'\e[2m'
CLR_BOLD=$'\e[1m'

say()  { echo -e "${CLR_CYAN}👉${CLR_RESET} $*"; }
warn() { echo -e "${CLR_YELLOW}⚠️${CLR_RESET} $*"; }
die()  { echo -e "${CLR_RED}❌ $*${CLR_RESET}" >&2; exit 1; }
# ------------------------------------------------------------------------------

if [[ ! -d "$REPO_DIR" ]]; then
  echo -e "${CLR_RED}❌ Repo dir not found: $REPO_DIR${CLR_RESET}"
  echo "   Expected repo at: $REPO_DIR_DEFAULT"
  echo "   Override with: REPO_DIR=\"/path/to/ada\" bash ./ada/tests/ada-tests.sh status"
  exit 1
fi

cd "$REPO_DIR"

need_password() {
  if [[ -z "${ADA_TEST_PASSWORD:-}" ]]; then
    die "Missing ADA_TEST_PASSWORD. Put it in ada-tests.secrets.sh (outside repo) or set env var."
  fi
}

have_cmd() { command -v "$1" >/dev/null 2>&1; }

# ---------------------- Runtime toggles (menu) ----------------------
MODE="${MODE:-MOCK}"          # MOCK or REAL
STRICT_ON="${STRICT_ON:-0}"   # 0/1, toggled by 's'
STRICT_ALLOW_HOSTS_RUNTIME="${STRICT_ALLOW_HOSTS:-$DEFAULT_STRICT_ALLOW_HOSTS}"

mode_label() {
  if [[ "${MODE^^}" == "REAL" ]]; then echo "REAL"; else echo "MOCK"; fi
}

strict_label() {
  if [[ "${STRICT_ON}" == "1" ]]; then echo "ON"; else echo "OFF"; fi
}

# Build env assignments for playwright runs
# Args:
#   $1 = base_url (optional)
#   $2 = deployed_flag (0/1)
build_envs() {
  local base_url="${1:-}"
  local deployed="${2:-0}"
  local -a envs=()

  [[ -n "$base_url" ]] && envs+=("BASE_URL=$base_url")

  if [[ "${MODE^^}" == "REAL" ]]; then
    envs+=("ALLOW_OPENAI=1")
  fi

  if [[ "$deployed" == "1" ]]; then
    envs+=("DEPLOYED=1" "DEPLOY_URL=$DEPLOY_URL")
  fi

  if [[ "${STRICT_ON}" == "1" ]]; then
    envs+=("STRICT_NETWORK=1" "STRICT_ALLOW_HOSTS=$STRICT_ALLOW_HOSTS_RUNTIME")
  fi

  printf '%s\n' "${envs[@]}"
}
# ------------------------------------------------------

# ---------------------- Logging (append, always) ----------------------
ensure_log_file() {
  if [[ ! -f "$LOG_FILE" ]]; then
    : > "$LOG_FILE"
  fi
  mkdir -p "$TRANSCRIPTS_DIR" >/dev/null 2>&1 || true
}

ts() { date +"%Y-%m-%d %H:%M:%S"; }
ts_compact() { date +"%Y%m%d_%H%M%S"; }

log_header() {
  local cmd="$1"
  ensure_log_file
  {
    echo "================================================================================"
    echo "[$(ts)] START cmd=$cmd  MODE=$(mode_label)  STRICT=$(strict_label)  REPO=$REPO_DIR"
    if [[ "${STRICT_ON}" == "1" ]]; then
      echo "[$(ts)] STRICT_ALLOW_HOSTS=$STRICT_ALLOW_HOSTS_RUNTIME"
    fi
  } >> "$LOG_FILE"
}

log_note() {
  local msg="$1"
  ensure_log_file
  echo "[$(ts)] NOTE  $msg" >> "$LOG_FILE"
}

log_footer() {
  local cmd="$1"
  local rc="$2"
  ensure_log_file
  {
    echo "[$(ts)] END   cmd=$cmd  rc=$rc"
    echo
  } >> "$LOG_FILE"
}
# ---------------------------------------------------------------------

# ---------------------- Anti-close (pause) ----------------------
should_pause() {
  if [[ "${ADA_TESTS_NO_PAUSE:-0}" == "1" ]]; then return 1; fi
  if [[ "${ADA_TESTS_PAUSE:-0}" == "1" ]]; then return 0; fi
  if [[ ! -t 0 ]]; then return 0; fi
  return 1
}

pause_if_needed() {
  local rc="${1:-0}"
  if should_pause; then
    echo ""
    if [[ "$rc" -eq 0 ]]; then
      echo -e "${CLR_DIM}Premi un tasto per chiudere...${CLR_RESET}"
    else
      echo -e "${CLR_YELLOW}Il comando è terminato con errori (rc=$rc).${CLR_RESET}"
      echo -e "${CLR_DIM}Premi un tasto per chiudere...${CLR_RESET}"
    fi
    if [[ -r /dev/tty ]]; then
      IFS= read -rsn1 -p "" </dev/tty || true
    else
      IFS= read -rsn1 -p "" || true
    fi
  fi
}
# ----------------------------------------------------

# ---------------------- Server checks ----------------------
server_is_up() {
  if have_cmd curl; then
    curl -fsS "$LOCAL_URL" >/dev/null 2>&1
    return $?
  fi
  if have_cmd powershell.exe; then
    powershell.exe -NoProfile -Command \
      "try { (Invoke-WebRequest -UseBasicParsing '$LOCAL_URL').StatusCode -eq 200 } catch { exit 1 }" \
      >/dev/null 2>&1
    return $?
  fi
  return 1
}

port_is_listening() {
  if have_cmd powershell.exe; then
    powershell.exe -NoProfile -Command \
      "try { \$p=$PORT; \$c=Get-NetTCPConnection -LocalPort \$p -State Listen -ErrorAction SilentlyContinue; if(\$c){ exit 0 } else { exit 1 } } catch { exit 1 }" \
      >/dev/null 2>&1
    return $?
  fi
  if have_cmd cmd.exe; then
    cmd.exe /c "netstat -ano | findstr /R /C:\":$PORT .*LISTENING\"" >/dev/null 2>&1
    return $?
  fi
  return 1
}

start_server_new_terminal() {
  local repo_win
  repo_win="$(cd "$REPO_DIR" && pwd -W 2>/dev/null || true)"
  if [[ -z "$repo_win" ]]; then repo_win="$REPO_DIR"; fi
  repo_win="${repo_win//$'\r'/}"

  say "Avvio server in un altro terminale (background): npm run serve"

  if have_cmd powershell.exe; then
    powershell.exe -NoProfile -Command \
      "Start-Process -FilePath 'cmd.exe' -WorkingDirectory '$repo_win' -ArgumentList '/k','npm run serve' -WindowStyle Normal" \
      >/dev/null 2>&1
    return 0
  fi

  cmd.exe /c start "ADA server" cmd.exe /k "cd /d \"$repo_win\" && npm run serve"
}

wait_for_server() {
  local max_seconds="${1:-25}"
  local i=0
  echo -e "${CLR_DIM}⏳ In attesa del server su: $LOCAL_URL (max ${max_seconds}s) ...${CLR_RESET}"
  while (( i < max_seconds )); do
    if server_is_up; then
      echo ""
      say "Server OK: $LOCAL_URL"
      return 0
    fi
    local remaining=$((max_seconds - i))
    echo -ne "${CLR_DIM}   ...ancora in attesa (${remaining}s)\r${CLR_RESET}"
    sleep 1
    ((i++))
  done
  echo ""
  warn "Server ancora non raggiungibile dopo ${max_seconds}s: $LOCAL_URL"
  warn "Controlla la finestra 'ADA server' (errori npm / porta occupata / firewall)."
  return 1
}

ensure_server_running() {
  if server_is_up; then
    say "Server già attivo: $LOCAL_URL"
    return 0
  fi
  if port_is_listening; then
    warn "La porta $PORT è già in ascolto, ma $LOCAL_URL non risponde."
    warn "Probabile: un altro processo sta usando la porta, oppure il server è in errore."
    warn "Soluzione: chiudi il processo su porta $PORT oppure avvia correttamente npm run serve."
    return 1
  fi
  start_server_new_terminal
  wait_for_server 25
}

start_server_background_and_wait() {
  if server_is_up; then
    say "Server già attivo: $LOCAL_URL (non apro nuove finestre)"
    return 0
  fi
  if port_is_listening; then
    warn "La porta $PORT è già in ascolto (qualcuno la sta usando)."
    warn "Non apro un'altra finestra server. Libera la porta o cambia PORT."
    return 1
  fi
  start_server_new_terminal
  wait_for_server 25
}
# -----------------------------------------------------------

# ---------------------- Test runners ----------------------
run_smoke_local() {
  need_password
  ensure_server_running
  say "Running SMOKE tests (local, $(mode_label), STRICT=$(strict_label)) ..."
  mapfile -t envs < <(build_envs "$LOCAL_URL" 0)
  env "${envs[@]}" npx playwright test --project=chromium --grep @smoke
}

run_smoke_local_headed() {
  need_password
  ensure_server_running
  say "Running SMOKE tests (local, headed, $(mode_label), STRICT=$(strict_label)) ..."
  mapfile -t envs < <(build_envs "$LOCAL_URL" 0)
  env "${envs[@]}" npx playwright test --project=chromium --grep @smoke --headed
}

run_regression_local() {
  need_password
  ensure_server_running
  say "Running REGRESSION tests (local, $(mode_label), STRICT=$(strict_label)) ..."
  mapfile -t envs < <(build_envs "$LOCAL_URL" 0)
  env "${envs[@]}" npx playwright test --project=chromium
}

run_long_local() {
  need_password
  ensure_server_running
  say "Running LONG tests @long (local, $(mode_label), STRICT=$(strict_label)) ..."
  mapfile -t envs < <(build_envs "$LOCAL_URL" 0)
  env "${envs[@]}" npx playwright test --project=chromium --grep @long
}

run_policy() {
  say "Running POLICY checks ..."
  node tests/policy/policy-checks.js
}

run_deployed() {
  need_password
  say "Running DEPLOYED tests ($(mode_label), STRICT=$(strict_label)) against: $DEPLOY_URL"
  mapfile -t envs < <(build_envs "" 1)
  env "${envs[@]}" npx playwright test --project=chromium --grep @deployed
}

# ---- Compatibility aliases (force strict ON for that run) ----
run_smoke_strict_local() { local prev="${STRICT_ON}"; STRICT_ON=1; run_smoke_local; STRICT_ON="$prev"; }
run_regression_strict_local() { local prev="${STRICT_ON}"; STRICT_ON=1; run_regression_local; STRICT_ON="$prev"; }
run_deployed_strict() { local prev="${STRICT_ON}"; STRICT_ON=1; run_deployed; STRICT_ON="$prev"; }
# -------------------------------------------------------------

install_all() {
  say "Installing deps (npm ci) ..."
  npm ci
  say "Installing Playwright browsers ..."
  npx playwright install --with-deps
  say "Done."
}

open_report() {
  say "Opening Playwright report..."
  npx playwright show-report
}

clean_artifacts() {
  say "Cleaning Playwright artifacts..."
  rm -rf playwright-report test-results .playwright .cache/ms-playwright 2>/dev/null || true
  say "Done."
}

status() {
  echo "================ ADA TEST STATUS ================"
  echo "Script dir:         $SCRIPT_DIR"
  echo "Repo dir:           $REPO_DIR"
  echo "Out dir:            $OUT_DIR"
  echo "------------------------------------------------"
  echo "Log file:           $LOG_FILE (append)"
  echo "Transcripts dir:    $TRANSCRIPTS_DIR"
  echo "Secrets file:       $SECRETS_FILE"
  [[ -f "$SECRETS_FILE" ]] && echo "Secrets present:    ✅ yes" || echo "Secrets present:    ❌ no"
  echo "------------------------------------------------"
  echo "Local URL:          $LOCAL_URL"
  echo "Deploy URL:         $DEPLOY_URL"
  echo "MODE:               $(mode_label)"
  echo "STRICT_NETWORK:     $(strict_label)"
  [[ "${STRICT_ON}" == "1" ]] && echo "STRICT_ALLOW_HOSTS: $STRICT_ALLOW_HOSTS_RUNTIME" || echo "STRICT_ALLOW_HOSTS: (n/a)"
  [[ -n "${ADA_TEST_PASSWORD:-}" ]] && echo "ADA_TEST_PASSWORD:  ✅ set" || echo "ADA_TEST_PASSWORD:  ❌ NOT set"
  echo "------------------------------------------------"
  if server_is_up; then echo "Local server:       ✅ reachable"; else echo "Local server:       ❌ not reachable"; fi
  if port_is_listening; then echo "Port ${PORT}:        ✅ LISTENING"; else echo "Port ${PORT}:        ❌ not listening"; fi
  echo "------------------------------------------------"
  echo -n "node: "; (have_cmd node && node -v) || echo "❌ missing"
  echo -n "npm:  "; (have_cmd npm  && npm -v)  || echo "❌ missing"
  echo -n "npx:  "; (have_cmd npx  && npx -v)  || echo "❌ missing"
  echo "================================================="
}

# ---------------------- Command dispatcher ----------------------
serve_foreground() { say "Starting local server (foreground) on port $PORT. Ctrl+C to stop."; npx http-server . -p "$PORT" -c-1; }

run_cmd() {
  local cmd="${1:-}"
  case "$cmd" in
    status) status ;;
    install) install_all ;;
    serve) serve_foreground ;;
    start-server-bg) start_server_background_and_wait ;;

    smoke) run_smoke_local ;;
    smoke-headed) run_smoke_local_headed ;;
    smoke-strict) run_smoke_strict_local ;;
    regression) run_regression_local ;;
    regression-strict) run_regression_strict_local ;;
    long) run_long_local ;;
    policy) run_policy ;;
    deployed) run_deployed ;;
    deployed-strict) run_deployed_strict ;;

    report) open_report ;;
    clean) clean_artifacts ;;

    "" ) ;;
    *) die "Unknown command: $cmd" ;;
  esac
}
# ----------------------------------------------------------------

# ---------------------- Logging wrapper (append) ----------------------
# Strategy:
# 1) If `script` exists: capture full output with pseudo-tty, append to ada-tests.log.
# 2) Else: use PowerShell Start-Transcript to capture full output to per-run transcript file,
#    and write a pointer to that transcript into ada-tests.log. (TTY preserved.)
run_cmd_safe() {
  local cmd="$1"
  local rc=0

  log_header "$cmd"

  local transcript_file="$TRANSCRIPTS_DIR/$(ts_compact)_${cmd}.log"

  if have_cmd script; then
    local tmp
    tmp="$(mktemp 2>/dev/null || printf "%s" "/tmp/ada-tests.$RANDOM.$RANDOM.out")"

    export -f run_cmd say warn die have_cmd need_password \
      server_is_up port_is_listening start_server_new_terminal wait_for_server \
      ensure_server_running start_server_background_and_wait \
      build_envs mode_label strict_label \
      run_smoke_local run_smoke_local_headed run_regression_local run_long_local run_policy run_deployed \
      run_smoke_strict_local run_regression_strict_local run_deployed_strict \
      install_all open_report clean_artifacts status
    export REPO_DIR PORT LOCAL_URL DEPLOY_URL MODE STRICT_ON STRICT_ALLOW_HOSTS_RUNTIME DEFAULT_STRICT_ALLOW_HOSTS ADA_TEST_PASSWORD

    set +e
    script -q -c "bash -lc 'cd \"${REPO_DIR}\"; run_cmd \"${cmd}\"'" "$tmp"
    rc=$?
    set -e

    cat "$tmp" >> "$LOG_FILE" || true
    rm -f "$tmp" >/dev/null 2>&1 || true
  else
    # PowerShell transcript fallback (full output to file)
    if have_cmd powershell.exe; then
      # Convert transcript path to Windows path for PowerShell
      local transcript_win="$transcript_file"
      if have_cmd cygpath; then
        transcript_win="$(cygpath -w "$transcript_file")"
      fi

      log_note "Full output captured via PowerShell transcript: $transcript_file"

      # Get Windows path to bash.exe so PowerShell can run it
      local bash_posix bash_win
      bash_posix="$(command -v bash || true)"
      bash_win="$bash_posix"
      if [[ -n "$bash_posix" ]] && have_cmd cygpath; then
        bash_win="$(cygpath -w "$bash_posix")"
      else
        # fallback: ask Windows "where" for bash.exe
        if have_cmd where.exe; then
          bash_win="$(where.exe bash 2>/dev/null | head -n 1 | tr -d '\r' || true)"
        fi
      fi

      if [[ -z "$bash_win" ]]; then
        warn "Impossibile trovare bash.exe per PowerShell transcript fallback."
        set +e
        run_cmd "$cmd"
        rc=$?
        set -e
      else
        # Build bash command line (executed inside bash -lc)
        local cmdline
        # Important: script now lives INSIDE repo: $REPO_DIR/tests/ada-tests.sh
        cmdline="cd \"$REPO_DIR\"; \"$REPO_DIR/tests/ada-tests.sh\" __run_cmd \"$cmd\""

        set +e
        powershell.exe -NoProfile -Command \
          "\$ErrorActionPreference='Stop';
            Start-Transcript -Path '$transcript_win' -Append | Out-Null;
            try {
              & '$bash_win' -lc '$cmdline';
              \$rc=\$LASTEXITCODE
            } catch {
              Write-Host \$_ -ForegroundColor Red;
              \$rc=1
            } finally {
              Stop-Transcript | Out-Null
            }
            exit \$rc"
        rc=$?
        set -e
      fi
    else
      warn "Né 'script' né powershell.exe disponibili: output completo non catturabile. Eseguo comando senza transcript."
      set +e
      run_cmd "$cmd"
      rc=$?
      set -e
    fi
  fi

  echo ""
  if [[ $rc -eq 0 ]]; then
    echo -e "${CLR_GREEN}AZIONE COMPLETATA SENZA ERRORI${CLR_RESET}"
  else
    echo -e "${CLR_RED}ERRORI PRESENTI.${CLR_RESET}"
    echo -e "${CLR_DIM}Vedi log (append) in: $LOG_FILE${CLR_RESET}"
  fi

  log_footer "$cmd" "$rc"

  pause_if_needed "$rc"
  return $rc
}
# ---------------------------------------------------------------------

# ---------------------- Menu ----------------------
menu_level=1
clear_screen() { printf "\e[2J\e[H"; }

wait_space_to_menu() {
  echo ""
  echo -e "${CLR_DIM}Premi SPAZIO per pulire lo schermo e tornare al menu... (ESC per uscire)${CLR_RESET}"
  local k=""
  while true; do
    IFS= read -rsn1 k
    if [[ "$k" == " " ]]; then
      clear_screen
      return 0
    fi
    if [[ "$k" == $'\e' ]]; then
      echo ""
      echo "Bye 👋"
      exit 0
    fi
  done
}

read_choice() { local k=""; IFS= read -rsn1 k; printf "%s" "$k"; }

print_help() {
  echo -e "${CLR_BOLD}================ HELP (h) ================${CLR_RESET}"
  echo ""
  echo -e "${CLR_BOLD}Tasti rapidi${CLR_RESET}"
  echo "  - m : MODE=MOCK"
  echo "  - r : MODE=REAL (imposta ALLOW_OPENAI=1 nei test)"
  echo "  - s : toggle STRICT_NETWORK ON/OFF"
  echo ""
  echo -e "${CLR_BOLD}LOG${CLR_RESET}"
  echo "  - Header/footer sempre in: $LOG_FILE (append)"
  echo "  - Output completo:"
  echo "      * se c'è 'script' -> appeso direttamente nel log"
  echo "      * altrimenti -> salvato in: $TRANSCRIPTS_DIR (PowerShell transcript) e linkato nel log"
  echo ""
  echo -e "${CLR_BOLD}ANTI-CHIUSURA${CLR_RESET}"
  echo "  - Se stdin non è un TTY, lo script fa PAUSE a fine comando."
  echo "  - Forza PAUSE: ADA_TESTS_PAUSE=1 | Disabilita: ADA_TESTS_NO_PAUSE=1"
  echo ""
  echo -e "${CLR_DIM}Premi SPAZIO per tornare al menu.${CLR_RESET}"
  echo -e "${CLR_BOLD}==========================================${CLR_RESET}"
}

print_header() {
  echo -e "${CLR_BOLD}================ ADA Tests (interactive) ================${CLR_RESET}"
  echo "Repo:   $REPO_DIR"
  echo "Out:    $OUT_DIR"
  echo "Local:  $LOCAL_URL"
  echo "Deploy: $DEPLOY_URL"
  echo "--------------------------------------------------------"
  echo -e "MODE:   ${CLR_BOLD}$(mode_label)${CLR_RESET}   |   STRICT_NETWORK: ${CLR_BOLD}$(strict_label)${CLR_RESET}  ${CLR_DIM}(m=MOCK r=REAL s=toggle)${CLR_RESET}"
  if [[ "${STRICT_ON}" == "1" ]]; then
    echo -e "${CLR_DIM}Allowlist: $STRICT_ALLOW_HOSTS_RUNTIME${CLR_RESET}"
  fi
  echo -e "${CLR_DIM}Log: $LOG_FILE (append)${CLR_RESET}"
  echo "--------------------------------------------------------"
  echo -e "${CLR_DIM}Tasti: h=help  ESC=esci  SPACE=menu  0=switch livello${CLR_RESET}"
  echo "--------------------------------------------------------"

  if [[ $menu_level -eq 1 ]]; then
    echo -e "${CLR_BOLD}MENU LIVELLO 1 (flusso normale)${CLR_RESET}"
    echo "1) Status"
    echo "2) Smoke (local, $(mode_label), STRICT=$(strict_label))"
    echo "3) Regression (local, $(mode_label), STRICT=$(strict_label))"
    echo "4) Policy checks"
    echo "5) Deployed ($(mode_label), STRICT=$(strict_label))"
    echo "6) Open report"
    echo "7) Clean artifacts"
    echo "0) Vai a MENU LIVELLO 2"
  else
    echo -e "${CLR_BOLD}MENU LIVELLO 2 (setup / varianti)${CLR_RESET}"
    echo "1) Install (npm ci + playwright install)"
    echo "2) Smoke headed (local, $(mode_label), STRICT=$(strict_label))"
    echo "3) Long tests @long (local, $(mode_label), STRICT=$(strict_label))"
    echo "4) Start server in other terminal (background)"
    echo "0) Torna a MENU LIVELLO 1"
  fi

  echo -e "${CLR_BOLD}========================================================${CLR_RESET}"
  echo -e "${CLR_DIM}Premi un tasto per scegliere (senza INVIO).${CLR_RESET}"
}

menu_loop() {
  clear_screen
  while true; do
    print_header
    local choice
    choice="$(read_choice)"

    if [[ "$choice" == $'\e' ]]; then echo ""; echo "Bye 👋"; exit 0; fi
    if [[ "$choice" == "h" || "$choice" == "H" ]]; then echo ""; print_help; wait_space_to_menu; continue; fi

    if [[ "$choice" == "m" || "$choice" == "M" ]]; then MODE="MOCK"; clear_screen; continue; fi
    if [[ "$choice" == "r" || "$choice" == "R" ]]; then MODE="REAL"; clear_screen; continue; fi
    if [[ "$choice" == "s" || "$choice" == "S" ]]; then
      if [[ "${STRICT_ON}" == "1" ]]; then STRICT_ON=0; else STRICT_ON=1; fi
      clear_screen; continue
    fi

    if [[ "$choice" == "0" ]]; then
      if [[ $menu_level -eq 1 ]]; then menu_level=2; else menu_level=1; fi
      clear_screen; continue
    fi

    echo ""

    # Never exit menu on failures (set -e)
    if [[ $menu_level -eq 1 ]]; then
      case "$choice" in
        1) run_cmd_safe status || true; wait_space_to_menu ;;
        2) run_cmd_safe smoke || true; wait_space_to_menu ;;
        3) run_cmd_safe regression || true; wait_space_to_menu ;;
        4) run_cmd_safe policy || true; wait_space_to_menu ;;
        5) run_cmd_safe deployed || true; wait_space_to_menu ;;
        6) run_cmd_safe report || true; wait_space_to_menu ;;
        7) run_cmd_safe clean || true; wait_space_to_menu ;;
        *) warn "Scelta non valida."; wait_space_to_menu ;;
      esac
    else
      case "$choice" in
        1) run_cmd_safe install || true; wait_space_to_menu ;;
        2) run_cmd_safe smoke-headed || true; wait_space_to_menu ;;
        3) run_cmd_safe long || true; wait_space_to_menu ;;
        4) run_cmd_safe start-server-bg || true; wait_space_to_menu ;;
        *) warn "Scelta non valida."; wait_space_to_menu ;;
      esac
    fi
  done
}

# ---------------------- Special internal entry ----------------------
# Used by PowerShell transcript fallback: re-run the internal command without menu.
if [[ "${1:-}" == "__run_cmd" ]]; then
  shift
  run_cmd "${1:-}"
  exit $?
fi

# ---------------------- CLI entrypoint ----------------------
if [[ $# -eq 0 ]]; then
  menu_loop
else
  run_cmd_safe "$1"
fi
