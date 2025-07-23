#!/system/bin/sh

MODDIR="$(dirname "$(readlink -f "$0")")"

# 定义颜色代码
GREEN='\033[0;92m'  # 亮绿色
BLUE='\033[0;94m'   # 亮蓝色
YELLOW='\033[0;93m' # 亮黄色
RED='\033[0;91m'    # 亮红色
NC='\033[0m'        # 重置颜色

# 打印标题
print_header() {
    clear
    printf "${GREEN}╭──────────────────────────────╮\n"
    printf "│    ${BLUE}🚀 OpenList 管理控制台 ${GREEN}   │\n"
    printf "╰──────────────────────────────╯${NC}\n"
    printf "${YELLOW} 乐享网: https://www.lxapk.com${NC}\n"
    printf "\n"
}

# 绘制进度条
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

# 手动更新函数
manual_update() {
    printf "\n${BLUE}▶ 正在启动手动更新...${NC}\n"
    
    # 创建临时文件
    tmpfile="$MODDIR/update_tmp.log"
    > "$tmpfile"
    
    # 启动更新进程
    sh "$MODDIR/update.sh" manual-update > "$tmpfile" 2>&1 &
    pid=$!
    
    # 监控更新进度
    while kill -0 $pid 2>/dev/null; do
        # 读取临时文件内容
        while IFS= read -r line; do
            # 检查是否为进度数字
            case $line in
                10|20|30|40|50|60|70|80|90|100)
                    print_progress "$line"
                    ;;
                *)
                    # 清除进度条行，然后输出消息
                    printf "\r\033[K"
                    printf "${YELLOW}$line${NC}\n"
                    ;;
            esac
        done < "$tmpfile"
        > "$tmpfile"  # 清空已处理内容
        sleep 0.5
    done
    
    # 读取剩余输出
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
    
    # 最后清除进度条
    printf "\r\033[K"
    printf "${GREEN}▶ 更新完成${NC}\n"
    
    rm -f "$tmpfile"
}

print_header

while true; do
    printf "${GREEN}请选择操作:${NC}\n"
    printf "${BLUE} 1. 手动更新 OpenList\n"
    printf " 2. 设置管理员密码\n"
    printf " 3. 查看服务状态\n"
    printf " 4. 退出${NC}\n"
    printf "\n"
    printf "${GREEN}请输入选项: ${NC}"
    
    read choice
    
    case $choice in
        1)
            manual_update
            ;;
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
            
            # 检查 openlist 进程
            if pgrep -f 'openlist' >/dev/null; then
                printf " OpenList 服务: ${GREEN}运行中 ✓${NC}\n"
            else
                printf " OpenList 服务: ${RED}已停止 ✗${NC}\n"
            fi
            
            # 检查更新进程
            if pgrep -f 'update.sh' >/dev/null; then
                printf " 自动更新服务: ${GREEN}运行中 ✓${NC}\n"
            else
                printf " 自动更新服务: ${RED}已停止 ✗${NC}\n"
            fi
            
            # 显示版本信息
            if [ -x "${MODDIR}/bin/openlist" ]; then
                version=$("${MODDIR}/bin/openlist" version 2>/dev/null | awk '/^Version:/ {print $2}')
                printf " 当前版本: ${BLUE}${version:-未知}${NC}\n"
            else
                printf " 当前版本: ${RED}未安装${NC}\n"
            fi
            
            # 显示IP地址
            ip=""
            if [ -d /sys/class/net/wlan0 ]; then
                ip=$(ip -o -4 addr show wlan0 2>/dev/null | awk '{print $4}' | cut -d'/' -f1)
            elif [ -d /sys/class/net/eth0 ]; then
                ip=$(ip -o -4 addr show eth0 2>/dev/null | awk '{print $4}' | cut -d'/' -f1)
            fi
            [ -z "$ip" ] && ip=$(ip route get 1 2>/dev/null | awk '{print $NF;exit}')
            printf " 设备IP: ${BLUE}${ip:-未获取到}${NC}\n"
            printf "${YELLOW}────────────────────────────────${NC}\n"
            ;;
        4)
            printf "\n${GREEN}▶ 感谢使用 OpenList${NC}\n\n"
            exit 0
            ;;
        *)
            printf "\n${RED}✗ 无效选项，请输入 1-4 的数字${NC}\n"
            sleep 1
            ;;
    esac
    
    printf "\n"
    printf "${YELLOW}按回车键继续...${NC}"
    read
    print_header
done