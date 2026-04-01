FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
ENV HOST=0.0.0.0
ENV PORT=1234
EXPOSE 1234
CMD ["npx", "y-websocket"]
