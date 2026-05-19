# Usamos una base oficial de Node.js robusta (Debian Bullseye)
FROM node:18-bullseye

# Le ordenamos a la máquina virtual que instale todo el arsenal pesado
RUN apt-get update && apt-get install -y \
    git \
    ffmpeg \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Creamos la carpeta principal de tu servidor
WORKDIR /app

# Copiamos tu package.json y descargamos las librerías base
COPY package*.json ./
RUN npm install

# Copiamos el server.js
COPY . .

# Le decimos a Railway qué puerto usar y cómo arrancar
EXPOSE 3000
CMD ["node", "server.js"]
