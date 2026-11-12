# 平台无关镜像：编译产物即为全部运行时，运行层不带 node_modules。
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund

COPY src ./src
COPY test ./test
COPY scripts ./scripts
RUN npm run build

FROM node:22-alpine

RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /app/dist/src ./dist/src
COPY --from=build /app/package.json ./package.json
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
