FROM node:22-alpine
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json server.js store.js prod.js ./
COPY public ./public
COPY prod-ui ./prod-ui
ENV PORT=3000 DATA_DIR=/data NODE_ENV=production TZ=America/Mexico_City
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
