#!/bin/bash
# 启动带远程调试的 Chrome，并确保 CDP Proxy 能找到正确端口

if pgrep -x "Google Chrome" > /dev/null; then
    osascript -e 'tell application "Google Chrome" to activate'
else
    open -a "Google Chrome" --args --remote-debugging-port=9222
    # 等 Chrome 启动完成
    sleep 5
fi

# 后台修正 DevToolsActivePort：chrome://inspect 可能覆盖 9222 用随机端口
(
    sleep 8
    ACTIVE_PORT_FILE="$HOME/Library/Application Support/Google/Chrome/DevToolsActivePort"

    for port in $(lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | grep "Google Chrome" | grep -oE ':\d+' | tr -d ':' | sort -u); do
        if curl -s --connect-timeout 2 "http://127.0.0.1:$port/json/version" 2>/dev/null | grep -q "Browser"; then
            WS_URL=$(curl -s "http://127.0.0.1:$port/json/version" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('webSocketDebuggerUrl',''))" 2>/dev/null)
            WS_PATH=$(echo "$WS_URL" | sed "s|ws://[^/]*/||")
            if [ -n "$WS_PATH" ]; then
                printf '%s\n/%s\n' "$port" "$WS_PATH" > "$ACTIVE_PORT_FILE"
            fi
            break
        fi
    done
) &
