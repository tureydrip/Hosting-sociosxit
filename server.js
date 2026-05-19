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
const activeBots = {}; 
const botLogs = {};    

function addLog(userId, message) {
    if (!botLogs[userId]) botLogs[userId] = [];
    const timestamp = new Date().toLocaleTimeString('es-ES');
    botLogs[userId].push(`[${timestamp}] ${message.trim()}`);
    if (botLogs[userId].length > 150) botLogs[userId].shift();
}

// Lógica pesada separada en una función
async function deployBotInBackground(userId, githubUrl) {
    const botsFolder = path.join(__dirname, 'bots');
    const userBotPath = path.join(botsFolder, userId);

    try {
        if (!fs.existsSync(botsFolder)) fs.mkdirSync(botsFolder);

        if (activeBots[userId]) {
            addLog(userId, `Deteniendo proceso anterior...`);
            activeBots[userId].kill();
            delete activeBots[userId];
        }
        
        if (fs.existsSync(userBotPath)) {
            addLog(userId, `Limpiando archivos viejos...`);
            fs.rmSync(userBotPath, { recursive: true, force: true });
        }

        addLog(userId, `Descargando repositorio desde GitHub...`);
        await execPromise(`git clone ${githubUrl} ${userBotPath}`);

        const pkgJsonPath = path.join(userBotPath, 'package.json');
        let startCommand = 'index.js';

        if (fs.existsSync(pkgJsonPath)) {
            addLog(userId, `Instalando librerías (npm install)... Esto puede tardar un poco.`);
            await execPromise(`npm install`, { cwd: userBotPath });
            const pkg = require(pkgJsonPath);
            if (pkg.main) startCommand = pkg.main;
        }

        addLog(userId, `¡Todo listo! Iniciando bot (${startCommand})...`);
        const botProcess = spawn('node', [startCommand], { cwd: userBotPath });
        activeBots[userId] = botProcess;

        botProcess.stdout.on('data', (data) => addLog(userId, data.toString()));
        botProcess.stderr.on('data', (data) => addLog(userId, `ERROR: ${data.toString()}`));
        botProcess.on('close', (code) => addLog(userId, `El bot se detuvo (Código: ${code})`));

    } catch (error) {
        addLog(userId, `ERROR CRÍTICO DURANTE INSTALACIÓN: ${error.message}`);
    }
}

app.post('/api/deploy', (req, res) => {
    const { githubUrl, userId, planPrice } = req.body;

    if (!githubUrl || !userId) {
        return res.status(400).json({ error: 'Faltan datos' });
    }

    // 1. Reiniciamos los logs del usuario
    botLogs[userId] = [];
    addLog(userId, `Iniciando conexión con el clúster XIT...`);

    // 2. RESPONDEMOS AL INSTANTE A LA PÁGINA WEB (Para que no de error de conexión)
    res.status(200).json({ success: true, message: 'Despliegue iniciado en segundo plano.' });

    // 3. Mandamos a ejecutar la instalación pesada sin hacer esperar al usuario
    deployBotInBackground(userId, githubUrl);
});

app.get('/api/logs/:userId', (req, res) => {
    const userId = req.params.userId;
    const logs = botLogs[userId] || ["Conectando con la terminal..."];
    res.json({ logs });
});

app.post('/api/stop', (req, res) => {
    const { userId } = req.body;
    if (activeBots[userId]) {
        activeBots[userId].kill();
        delete activeBots[userId];
        addLog(userId, `Bot apagado por el sistema.`);
        res.json({ success: true, message: 'Bot detenido exitosamente.' });
    } else {
        res.status(404).json({ error: 'No hay bot activo.' });
    }
});

app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));
