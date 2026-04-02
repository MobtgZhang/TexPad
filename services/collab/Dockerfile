FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.cjs ./
ENV HOST=0.0.0.0
ENV PORT=18475
EXPOSE 18475
CMD ["node", "server.cjs"]
