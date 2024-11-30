# Use the Node.js image with Alpine for a smaller footprint
FROM node:22-alpine3.19

RUN apk add --no-cache g++ gcc make python3

# Set working directory
WORKDIR /app

# Copy package.json and yarn.lock first to install dependencies
COPY package.json yarn.lock ./

COPY ./packages/relayer/package.json ./packages/relayer/package.json

COPY .yarnrc.yml .yarnrc.yml

# # # Copy the rest of the application code
COPY ./packages ./packages

# # Install dependencies
RUN yarn install --immutable

# # Start the server
CMD ["yarn --cwd ./packages/relayer", "start"]

