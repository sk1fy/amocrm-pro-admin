# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS dependencies
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_BACKEND_DETAIL_INTERVAL_MS=15000
ARG VITE_BACKEND_LIST_INTERVAL_MS=90000
ARG VITE_OPERATION_INTERVAL_MS=1500
ENV VITE_BACKEND_DETAIL_INTERVAL_MS=$VITE_BACKEND_DETAIL_INTERVAL_MS \
    VITE_BACKEND_LIST_INTERVAL_MS=$VITE_BACKEND_LIST_INTERVAL_MS \
    VITE_OPERATION_INTERVAL_MS=$VITE_OPERATION_INTERVAL_MS

FROM dependencies AS build-core
RUN npm run build:core

FROM dependencies AS build-managers
RUN npm run build:managers

FROM dependencies AS build-demo
RUN npm run build:demo

FROM nginx:1.27-alpine AS managers
ARG BUILD_REVISION=unknown
LABEL org.opencontainers.image.revision=$BUILD_REVISION io.rakurs.frontend.purpose=managers
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build-managers /src/dist-managers /usr/share/nginx/html
EXPOSE 80

FROM nginx:1.27-alpine AS demo
ARG BUILD_REVISION=unknown
LABEL org.opencontainers.image.revision=$BUILD_REVISION io.rakurs.frontend.purpose=demo
COPY nginx.demo.conf /etc/nginx/conf.d/default.conf
COPY --from=build-demo /src/dist-demo /usr/share/nginx/html
EXPOSE 80

FROM nginx:1.27-alpine AS core
ARG BUILD_REVISION=unknown
LABEL org.opencontainers.image.revision=$BUILD_REVISION io.rakurs.frontend.purpose=core
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx.core.conf /etc/nginx/default.d/core.conf
COPY --from=build-core /src/dist /usr/share/nginx/html
EXPOSE 80
