const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

const execPromise = util.promisify(exec);
const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const activeBots = {}; // Guarda los procesos de los usuarios
const botLogs = {};    // Guarda los logs de la consola de cada usuario

// Función para guardar los logs (máximo 150 líneas para no saturar la memoria)
function addLog(userId, message) {
    if (!botLogs[userId]) botLogs[userId] = [];
    const timestamp = new Date().toLocaleTimeString('es-ES');
    botLogs[userId].push(`[${timestamp}] ${message.trim()}`);
    if (botLogs[userId].length > 150) botLogs[userId].shift();
}

app.post('/api/deploy', async (req, res) => {
    const { githubUrl, userId, planPrice } = req.body;

    if (!githubUrl || !userId) {
        return res.status(400).json({ error: 'Faltan datos (URL de GitHub o ID de usuario)' });
    }

    const botsFolder = path.join(__dirname, 'bots');
    const userBotPath = path.join(botsFolder, userId);

    try {
        if (!fs.existsSync(botsFolder)) fs.mkdirSync(botsFolder);

        // Limpiar bot anterior y sus logs
        if (activeBots[userId]) {
            activeBots[userId].kill();
            delete activeBots[userId];
        }
        botLogs[userId] = []; // Reiniciar logs
        addLog(userId, `Iniciando proceso de despliegue...`);

        if (fs.existsSync(userBotPath)) fs.rmSync(userBotPath, { recursive: true, force: true });

        addLog(userId, `Clonando repositorio: ${githubUrl}`);
        await execPromise(`git clone ${githubUrl} ${userBotPath}`);

        const pkgJsonPath = path.join(userBotPath, 'package.json');
        let startCommand = 'index.js';

        if (fs.existsSync(pkgJsonPath)) {
            addLog(userId, `Instalando dependencias (npm install)...`);
            await execPromise(`npm install`, { cwd: userBotPath });
            const pkg = require(pkgJsonPath);
            if (pkg.main) startCommand = pkg.main;
        }

        addLog(userId, `Iniciando bot con el archivo principal: ${startCommand}`);
        const botProcess = spawn('node', [startCommand], { cwd: userBotPath });
        activeBots[userId] = botProcess;

        // Capturar los logs reales del bot del cliente
        botProcess.stdout.on('data', (data) => addLog(userId, data.toString()));
        botProcess.stderr.on('data', (data) => addLog(userId, `ERROR: ${data.toString()}`));
        botProcess.on('close', (code) => addLog(userId, `Bot detenido o crasheado (Código: ${code})`));

        res.status(200).json({ success: true, message: 'Bot ejecutándose.' });

    } catch (error) {
        addLog(userId, `ERROR CRÍTICO: ${error.message}`);
        res.status(500).json({ error: 'Error al compilar el bot', details: error.message });
    }
});

// NUEVO: Endpoint para leer los logs desde la web
app.get('/api/logs/:userId', (req, res) => {
    const userId = req.params.userId;
    const logs = botLogs[userId] || ["No hay logs disponibles o el bot no ha sido desplegado aún."];
    res.json({ logs });
});

app.post('/api/stop', (req, res) => {
    const { userId } = req.body;
    if (activeBots[userId]) {
        activeBots[userId].kill();
        delete activeBots[userId];
        addLog(userId, `Bot apagado por el sistema (Plan expirado o detenido por usuario).`);
        res.json({ success: true, message: 'Bot detenido exitosamente.' });
    } else {
        res.status(404).json({ error: 'No hay bot activo.' });
    }
});

app.listen(PORT, () => console.log(`Servidor de Hosting XIT corriendo en el puerto ${PORT}`));
