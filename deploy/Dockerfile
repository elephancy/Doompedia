FROM caddy:2-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f

# Preserve the verified hardened baseline layer; see deploy/README.md.
ARG HARDENING_EPOCH=1793823279
RUN setcap -r /usr/bin/caddy \
    && test -z "$(getcap /usr/bin/caddy)" \
    && addgroup -S -g 10001 doompedia \
    && adduser -S -D -H -u 10001 -G doompedia doompedia \
    && sed -i -E "s/^(doompedia:[^:]*:)[0-9]+:/\1$((HARDENING_EPOCH / 86400)):/" /etc/shadow \
    && touch -d "@$HARDENING_EPOCH" /etc/group /etc/group- /etc/passwd /etc/shadow /etc

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY web/assets/elephant-logo.png web/assets/favicon.ico /brand/assets/

USER doompedia
