#!/system/bin/sh

THEME_FILE="/data/adb/modules/OpenList/data/theme.conf"

mkdir -p "$(dirname "$THEME_FILE")"

if [ ! -f "$THEME_FILE" ]; then
    echo "theme=light" > "$THEME_FILE"
fi

grep '^theme=' "$THEME_FILE" | cut -d'=' -f2
