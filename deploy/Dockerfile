FROM caddy:2-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f

RUN setcap -r /usr/bin/caddy \
    && test -z "$(getcap /usr/bin/caddy)" \
    && addgroup -S -g 10001 doompedia \
    && adduser -S -D -H -u 10001 -G doompedia doompedia

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY web/assets/elephant-logo.png web/assets/favicon.ico /brand/assets/

USER doompedia
