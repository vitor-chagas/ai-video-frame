# Use Node.js 20 as the base image
FROM node:20-slim

# Install system dependencies for Python, OpenCV, and MediaPipe
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    libsm6 \
    libxext6 \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy package files and install Node.js dependencies
COPY package*.json ./
RUN npm install

# Copy Python requirements and install Python dependencies
COPY requirements.txt ./
# Create a virtual environment for Python to avoid break-system-packages issues in newer debian/ubuntu
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Build the frontend and backend
RUN npm run build

# Create uploads directories
RUN mkdir -p uploads/input uploads/output

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000

# Expose the port
EXPOSE 5000

# Start the application
CMD ["npm", "start"]
