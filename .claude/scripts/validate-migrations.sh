#!/usr/bin/env bash
# validate-migrations.sh — Pre-commit check for database migration safety
# Catches: non-idempotent DDL, destructive operations without guards, missing IF NOT EXISTS/IF EXISTS
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
MIGRATIONS_DIR="$REPO_ROOT/drizzle"
ERRORS=()
WARNINGS=()

# Only check staged SQL files in drizzle/
STAGED_SQL=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep '^drizzle/.*\.sql$' || true)

# If no staged migration files, also check all migrations for safety
if [ -z "$STAGED_SQL" ]; then
  # Check all migration files when committing non-migration changes
  # (in case someone modified a migration file earlier without staging it properly)
  ALL_SQL=$(find "$MIGRATIONS_DIR" -name '*.sql' -type f 2>/dev/null || true)
  if [ -z "$ALL_SQL" ]; then
    echo '{"continue": true}'
    exit 0
  fi
  CHECK_FILES="$ALL_SQL"
  CHECK_MODE="full"
else
  CHECK_FILES="$STAGED_SQL"
  CHECK_MODE="staged"
fi

while IFS= read -r file; do
  [ -z "$file" ] && continue

  # Resolve full path
  if [[ "$file" != /* ]]; then
    filepath="$REPO_ROOT/$file"
  else
    filepath="$file"
  fi

  [ ! -f "$filepath" ] && continue

  basename=$(basename "$file")
  content=$(cat "$filepath")

  # === CRITICAL: ADD COLUMN without IF NOT EXISTS ===
  if echo "$content" | grep -iqE 'ADD\s+COLUMN' && ! echo "$content" | grep -iqE 'ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS'; then
    ERRORS+=("$basename: ADD COLUMN without IF NOT EXISTS — will crash on re-run if column exists")
  fi

  # === CRITICAL: DROP COLUMN without IF EXISTS ===
  if echo "$content" | grep -iqE 'DROP\s+COLUMN' && ! echo "$content" | grep -iqE 'DROP\s+COLUMN\s+IF\s+EXISTS'; then
    ERRORS+=("$basename: DROP COLUMN without IF EXISTS — will crash if column already dropped")
  fi

  # === CRITICAL: DROP TABLE without IF EXISTS ===
  if echo "$content" | grep -iqE 'DROP\s+TABLE' && ! echo "$content" | grep -iqE 'DROP\s+TABLE\s+IF\s+EXISTS'; then
    ERRORS+=("$basename: DROP TABLE without IF EXISTS — will crash if table doesn't exist")
  fi

  # === CRITICAL: CREATE TABLE without IF NOT EXISTS ===
  if echo "$content" | grep -iqE 'CREATE\s+TABLE' && ! echo "$content" | grep -iqE 'CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS'; then
    WARNINGS+=("$basename: CREATE TABLE without IF NOT EXISTS — consider adding for idempotency")
  fi

  # === CRITICAL: CREATE INDEX without IF NOT EXISTS ===
  if echo "$content" | grep -iqE 'CREATE\s+(UNIQUE\s+)?INDEX' && ! echo "$content" | grep -iqE 'CREATE\s+(UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?IF\s+NOT\s+EXISTS'; then
    WARNINGS+=("$basename: CREATE INDEX without IF NOT EXISTS — consider adding for idempotency")
  fi

  # === WARNING: TRUNCATE (data loss) ===
  if echo "$content" | grep -iqE '^\s*TRUNCATE\s'; then
    ERRORS+=("$basename: TRUNCATE detected — this causes irreversible data loss in production")
  fi

  # === WARNING: DROP TABLE (data loss) ===
  if echo "$content" | grep -iqE 'DROP\s+TABLE'; then
    WARNINGS+=("$basename: DROP TABLE detected — ensure data is backed up or migrated first")
  fi

  # === WARNING: ALTER TYPE / column type change ===
  if echo "$content" | grep -iqE 'ALTER\s+COLUMN.*TYPE\s'; then
    WARNINGS+=("$basename: Column type change detected — may fail on data that can't be cast")
  fi

  # === WARNING: NOT NULL without DEFAULT ===
  if echo "$content" | grep -iqE 'ADD\s+COLUMN.*NOT\s+NULL' && ! echo "$content" | grep -iqE 'DEFAULT\s'; then
    ERRORS+=("$basename: Adding NOT NULL column without DEFAULT — will fail if table has existing rows")
  fi

done <<< "$CHECK_FILES"

# === Check Terraform/ECS consistency ===
STAGED_TF=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep '^infra/.*\.tf$' || true)
STAGED_AUTH=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep 'apps/api/src' || true)

# If env.ts or auth.ts changed, check if new env vars are referenced in Terraform
if [ -n "$STAGED_AUTH" ]; then
  # Look for process.env.NEW_VAR patterns in staged API files
  NEW_ENVS=$(git diff --cached -- apps/api/src/ 2>/dev/null | grep -oE 'process\.env\.[A-Z_]+' | sed 's/process\.env\.//' | sort -u || true)
  if [ -n "$NEW_ENVS" ]; then
    TF_MAIN="$REPO_ROOT/infra/environments/prod/main.tf"
    if [ -f "$TF_MAIN" ]; then
      while IFS= read -r envvar; do
        [ -z "$envvar" ] && continue
        if ! grep -q "$envvar" "$TF_MAIN"; then
          WARNINGS+=("API code references $envvar but it's not in Terraform ECS task definition — add it to infra/environments/prod/main.tf")
        fi
      done <<< "$NEW_ENVS"
    fi
  fi
fi

# Build output
if [ ${#ERRORS[@]} -gt 0 ]; then
  ERROR_MSG="MIGRATION VALIDATION FAILED:\\n"
  for err in "${ERRORS[@]}"; do
    ERROR_MSG+="  ERROR: $err\\n"
  done
  for warn in "${WARNINGS[@]}"; do
    ERROR_MSG+="  WARN: $warn\\n"
  done
  ERROR_MSG+="\\nFix these issues before committing. Migrations must be idempotent for safe ECS rolling deploys."

  echo "{\"continue\": false, \"reason\": \"$(echo -e "$ERROR_MSG" | sed 's/"/\\"/g' | tr '\n' ' ')\"}"
  exit 0
elif [ ${#WARNINGS[@]} -gt 0 ]; then
  WARN_MSG="Migration warnings (non-blocking):\\n"
  for warn in "${WARNINGS[@]}"; do
    WARN_MSG+="  WARN: $warn\\n"
  done
  echo "{\"hookSpecificOutput\": {\"hookEventName\": \"PreToolUse\", \"additionalContext\": \"$(echo -e "$WARN_MSG" | sed 's/"/\\"/g' | tr '\n' ' ')\"}}"
  exit 0
else
  echo '{"continue": true}'
  exit 0
fi
