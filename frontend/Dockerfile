# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS build

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
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html

EXPOSE 80
