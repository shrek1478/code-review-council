# ============================================
# Stage 1: Build
# ============================================
FROM node:24-alpine AS build

# Preserve the same relative path structure as host
# so package.json's "file:../copilot-sdk-acp/copilot-sdk/nodejs" resolves correctly
WORKDIR /app/code-review-council

# Copy copilot-sdk to the expected relative path
COPY copilot-sdk-acp/copilot-sdk/nodejs /app/copilot-sdk-acp/copilot-sdk/nodejs

# Copy package files
COPY code-review-council/package.json code-review-council/package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code and build config
COPY code-review-council/src ./src
COPY code-review-council/tsconfig.json code-review-council/tsconfig.build.json code-review-council/nest-cli.json ./

# Build TypeScript
RUN npx nest build

# ============================================
# Stage 2: Production
# ============================================
FROM node:24-alpine AS production

# Install git (required by simple-git at runtime)
RUN apk add --no-cache git

# Install AI CLI tools globally
# NOTE: Verify actual npm package names and uncomment before building.
# RUN npm install -g @anthropic-ai/claude-code \
#     && npm install -g @google/gemini-cli \
#     && npm install -g @github/copilot-cli

WORKDIR /app/code-review-council

# Copy copilot-sdk to the expected relative path
COPY copilot-sdk-acp/copilot-sdk/nodejs /app/copilot-sdk-acp/copilot-sdk/nodejs

# Copy package files
COPY code-review-council/package.json code-review-council/package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built output from build stage
COPY --from=build /app/code-review-council/dist ./dist

# Copy default config (can be overridden by volume mount or CONFIG_JSON env var)
COPY code-review-council/review-council.config.json ./review-council.config.json

# Use non-root user for security
USER node

ENTRYPOINT ["node", "/app/code-review-council/dist/cli.js"]
