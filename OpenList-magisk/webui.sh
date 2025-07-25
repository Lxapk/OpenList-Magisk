#!/system/bin/sh

MODDIR="$(dirname "$(readlink -f "$0")")"

GREEN='\033[0;92m'
BLUE='\033[0;94m'
YELLOW='\033[0;93m'
RED='\033[0;91m'
NC='\033[0m'

print_header() {
    clear
    printf "${GREEN}╭──────────────────────────────╮\n"
    printf "│    ${BLUE}🚀 OpenList 管理控制台 ${GREEN}   │\n"
    printf "╰──────────────────────────────╯${NC}\n"
    printf "${YELLOW} 乐享网: https://www.lxapk.com${NC}\n\n"
}

print_progress() {
    local width=30
    local percent=$1
    local filled=$((width * percent / 100))
    local empty=$((width - filled))

    printf "\r${GREEN}["
    while [ $filled -gt 0 ]; do
        printf "="
        filled=$((filled - 1))
    done
    while [ $empty -gt 0 ]; do
        printf " "
        empty=$((empty - 1))
    done
    printf "] ${percent}%%${NC}"
}

manual_update() {
    printf "\n${BLUE}▶ 正在启动手动更新...${NC}\n"
    tmpfile="$MODDIR/update_tmp.log"
    > "$tmpfile"
    sh "$MODDIR/update.sh" manual-update > "$tmpfile" 2>&1 &
    pid=$!

    while kill -0 $pid 2>/dev/null; do
        while IFS= read -r line; do
            case $line in
                10|20|30|40|50|60|70|80|90|100)
                    print_progress "$line"
                    ;;
                *)
                    printf "\r\033[K"
                    printf "${YELLOW}$line${NC}\n"
                    ;;
            esac
        done < "$tmpfile"
        > "$tmpfile"
        sleep 0.5
    done

    while IFS= read -r line; do
        case $line in
            10|20|30|40|50|60|70|80|90|100)
                print_progress "$line"
                ;;
            *)
                printf "\r\033[K"
                printf "${YELLOW}$line${NC}\n"
                ;;
        esac
    done < "$tmpfile"

    printf "\r\033[K"
    printf "${GREEN}▶ 更新完成${NC}\n"
    rm -f "$tmpfile"
}

backup_data() {
    printf "\n${BLUE}▶ 正在创建数据备份...${NC}\n"
    timestamp=$(TZ='Asia/Shanghai' date +%Y%m%d-%H%M%S)
    backup_name="OpenList-backup-${timestamp}.tar.gz"
    backup_path="/sdcard/OpenList/backups/${backup_name}"

    mkdir -p "/sdcard/OpenList/backups" 2>/dev/null
    tar --exclude='data/temp' --exclude='data/log' -czf "${backup_path}" -C "/data/adb/modules/OpenList" data 2>&1
    if [ $? -eq 0 ]; then
        printf "${GREEN}✓ 备份完成！${NC}\n"
        printf "  📁 文件路径: ${BLUE}${backup_path}${NC}\n"
    else
        printf "${RED}✗ 备份失败${NC}\n"
        return 1
    fi
}

list_backups() {
    printf "\n${BLUE}▶ 可用的备份文件:${NC}\n"
    backups=$(ls -1 /sdcard/OpenList/backups/*.tar.gz 2>/dev/null)
    if [ -z "$backups" ]; then
        printf "${YELLOW}  暂无备份文件${NC}\n"
        return 1
    fi
    i=1
    echo "$backups" | while IFS= read -r file; do
        printf "  ${GREEN}%d. %s${NC}\n" $i "$(basename "$file")"
        i=$((i + 1))
    done
}

restore_data() {
    printf "\n${BLUE}▶ 恢复数据${NC}\n"
    list_backups
    if [ $? -ne 0 ]; then
        printf "${RED}✗ 无可用备份文件${NC}\n"
        return 1
    fi

    printf "${GREEN}请输入备份编号 (或输入 0 取消): ${NC}"
    read backup_num

    if [ "$backup_num" = "0" ]; then
        printf "${YELLOW}▶ 已取消恢复${NC}\n"
        return 0
    fi

    backup_file=$(ls -1 /sdcard/OpenList/backups/*.tar.gz 2>/dev/null | sed -n "${backup_num}p")
    if [ -z "$backup_file" ] || [ ! -f "$backup_file" ]; then
        printf "${RED}✗ 无效的备份编号${NC}\n"
        return 1
    fi

    printf "${YELLOW}正在停止 OpenList 服务...${NC}\n"
    pkill -9 -f /data/adb/modules/OpenList/bin/openlist 2>/dev/null

    printf "${YELLOW}正在恢复数据...${NC}\n"
    tar -xzf "${backup_file}" -C /data/adb/modules/OpenList 2>&1
    if [ $? -eq 0 ]; then
        printf "${GREEN}✓ 数据恢复成功${NC}\n"
    else
        printf "${RED}✗ 数据恢复失败${NC}\n"
        return 1
    fi
}

get_ip_port() {
    local ip port cfg="$MODDIR/data/config.json"

    ip=$(sh -c '
        ip -o -4 addr show 2>/dev/null |
        awk -F"[ /]+" "/inet / && \$4 != \"127.0.0.1\" {print \$4; exit}" ||
        ip route get 1 2>/dev/null |
        awk -F"src " "/src / {print \$2; exit}"
    ')

    [ -z "$ip" ] && ip="127.0.0.1"
    [ -r "$cfg" ] && \
        port=$(awk -F'[:"[:space:]]+' '/"http_port"/ {print $3}' "$cfg" 2>/dev/null | tr -d ', ')
    [ -z "$port" ] && port=5244

    echo "${ip}:${port}"
}

print_header

while true; do
    printf "${GREEN}请选择操作:${NC}\n"
    printf "${BLUE} 1. 手动更新 OpenList\n"
    printf " 2. 设置管理员密码\n"
    printf " 3. 查看服务状态\n"
    printf " 4. 备份数据\n"
    printf " 5. 恢复数据\n"
    printf " 6. 退出${NC}\n\n"
    printf "${GREEN}请输入选项: ${NC}"
    read choice

    case $choice in
        1) manual_update ;;
        2)
            printf "\n${BLUE}▶ 设置管理员密码${NC}\n"
            printf "${GREEN}请输入新密码: ${NC}"
            stty -echo
            read password
            stty echo
            printf "\n"
            printf "${GREEN}请再次输入新密码: ${NC}"
            stty -echo
            read confirm_password
            stty echo
            printf "\n"

            if [ "$password" != "$confirm_password" ]; then
                printf "${RED}✗ 两次输入的密码不一致!${NC}\n"
            elif [ -z "$password" ]; then
                printf "${RED}✗ 密码不能为空!${NC}\n"
            else
                encoded=$(echo -n "$password" | base64)
                sh "$MODDIR/update.sh" set-password-base64 "$encoded"
                if [ $? -eq 0 ]; then
                    printf "${GREEN}✓ 密码设置成功${NC}\n"
                else
                    printf "${RED}✗ 密码设置失败${NC}\n"
                fi
            fi
            ;;
        3)
            printf "\n${BLUE}▶ 服务状态信息${NC}\n"
            printf "${YELLOW}────────────────────────────────${NC}\n"

            if pgrep -f 'openlist' >/dev/null; then
                printf " OpenList 服务: ${GREEN}运行中 ✓${NC}\n"
            else
                printf " OpenList 服务: ${RED}已停止 ✗${NC}\n"
            fi

            if pgrep -f 'update.sh' >/dev/null; then
                printf " 自动更新服务: ${GREEN}运行中 ✓${NC}\n"
            else
                printf " 自动更新服务: ${RED}已停止 ✗${NC}\n"
            fi

            if [ -x "${MODDIR}/bin/openlist" ]; then
                version=$("${MODDIR}/bin/openlist" version 2>/dev/null | awk '/^Version:/ {print $2}')
                printf " 当前版本: ${BLUE}${version:-未知}${NC}\n"
            else
                printf " 当前版本: ${RED}未安装${NC}\n"
            fi

            ip_port=$(get_ip_port)
            printf "本机设备IP: ${BLUE}${ip_port}${NC}\n"
            printf "${YELLOW}────────────────────────────────${NC}\n"
            ;;
        4) backup_data ;;
        5) restore_data ;;
        6)
            printf "\n${GREEN}▶ 感谢使用 OpenList${NC}\n\n"
            exit 0
            ;;
        *)
            printf "\n${RED}✗ 无效选项，请输入 1-6 的数字${NC}\n"
            sleep 1
            ;;
    esac

    printf "\n"
    printf "${YELLOW}按回车键继续...${NC}"
    read
    print_header
done
