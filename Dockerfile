# ============================================
# Stage 1: Build
# ============================================
FROM node:24-alpine AS build

WORKDIR /app

# GitHub Packages auth token (required for @shrek1478 scoped packages)
ARG NPM_GITHUB_TOKEN

# Copy package files and .npmrc
COPY package.json package-lock.json .npmrc ./

# Set auth token for GitHub Packages
RUN echo "//npm.pkg.github.com/:_authToken=${NPM_GITHUB_TOKEN}" >> .npmrc

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code and build config
COPY src ./src
COPY tsconfig.json tsconfig.build.json nest-cli.json ./

# Build TypeScript
RUN npx nest build

# ============================================
# Stage 2: Production
# ============================================
FROM node:24-alpine AS production

# Install git (required by simple-git at runtime)
RUN apk add --no-cache git

WORKDIR /app

# GitHub Packages auth token
ARG NPM_GITHUB_TOKEN

# Copy package files and .npmrc
COPY package.json package-lock.json .npmrc ./

# Set auth token for GitHub Packages
RUN echo "//npm.pkg.github.com/:_authToken=${NPM_GITHUB_TOKEN}" >> .npmrc

# Install production dependencies only
RUN npm ci --omit=dev

# Remove auth token from .npmrc after install
RUN sed -i '/_authToken/d' .npmrc

# Copy built output from build stage
COPY --from=build /app/dist ./dist

# Copy default config (can be overridden by volume mount or CONFIG_JSON env var)
COPY review-council.config.json ./review-council.config.json

# Use non-root user for security
USER node

ENTRYPOINT ["node", "/app/dist/cli.js"]
