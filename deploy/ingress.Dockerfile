FROM nginx:1.27-alpine
ARG BUILD_REVISION=unknown
LABEL org.opencontainers.image.revision=$BUILD_REVISION io.rakurs.release.purpose=ingress
COPY ingress.conf.template /etc/admin-ingress.conf.template
COPY ingress-entrypoint.sh /usr/local/bin/admin-ingress
ENTRYPOINT ["/bin/sh", "/usr/local/bin/admin-ingress"]
CMD ["nginx", "-g", "daemon off;"]
