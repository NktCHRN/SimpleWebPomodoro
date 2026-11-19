FROM nginx:1.31.9-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

# The app is plain static files — no build step.
COPY public/ /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
