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
    if (botLogs[userId].length > 150) botLogs[userId].shift(); // Mantiene la consola limpia (solo últimas 150 líneas)
}

// Lógica pesada separada en una función de fondo
async function deployBotInBackground(userId, githubUrl) {
    const botsFolder = path.join(__dirname, 'bots');
    const userBotPath = path.join(botsFolder, userId);

    try {
        if (!fs.existsSync(botsFolder)) fs.mkdirSync(botsFolder);

        if (activeBots[userId]) {
            addLog(userId, `Deteniendo bot anterior para actualizar...`);
            activeBots[userId].kill();
            delete activeBots[userId];
        }
        
        if (fs.existsSync(userBotPath)) {
            addLog(userId, `Limpiando almacenamiento viejo...`);
            fs.rmSync(userBotPath, { recursive: true, force: true });
        }

        addLog(userId, `Descargando repositorio (${githubUrl})...`);
        await execPromise(`git clone ${githubUrl} ${userBotPath}`);

        const pkgJsonPath = path.join(userBotPath, 'package.json');
        let startCommand = 'index.js';

        if (fs.existsSync(pkgJsonPath)) {
            addLog(userId, `Instalando librerías Node.js... Esto puede tardar unos minutos.`);
            try {
                // Instalación forzada para evitar errores de conflictos de versiones que tienen muchos bots
                await execPromise(`npm install --legacy-peer-deps --no-audit --no-fund`, { cwd: userBotPath });
                addLog(userId, `Librerías instaladas con éxito.`);
            } catch (npmError) {
                addLog(userId, `Advertencia en npm install, pero intentaremos prenderlo de todos modos...`);
            }
            
            const pkg = require(pkgJsonPath);
            if (pkg.main) startCommand = pkg.main;
            if (pkg.scripts && pkg.scripts.start) {
                // Si el usuario tiene un comando "npm start", preferimos ese
                startCommand = 'npm start';
            }
        }

        addLog(userId, `¡Todo listo! Iniciando sistema...`);
        
        // Determinar cómo arrancar (si es npm start o node index.js)
        let botProcess;
        if (startCommand === 'npm start') {
            botProcess = spawn('npm', ['start'], { cwd: userBotPath });
        } else {
            botProcess = spawn('node', [startCommand], { cwd: userBotPath });
        }
        
        activeBots[userId] = botProcess;

        // Capturar la consola real del bot
        botProcess.stdout.on('data', (data) => addLog(userId, data.toString()));
        botProcess.stderr.on('data', (data) => addLog(userId, `ERROR DEL BOT: ${data.toString()}`));
        botProcess.on('close', (code) => {
            if (code !== null && code !== 0) {
                addLog(userId, `El bot se crasheó o se detuvo (Código: ${code}). Revisa los errores arriba.`);
            } else {
                addLog(userId, `El bot se apagó correctamente.`);
            }
        });

    } catch (error) {
        addLog(userId, `ERROR CRÍTICO DEL SERVIDOR: ${error.message}`);
    }
}

app.post('/api/deploy', (req, res) => {
    const { githubUrl, userId, planPrice } = req.body;

    if (!githubUrl || !userId) {
        return res.status(400).json({ error: 'Faltan datos' });
    }

    botLogs[userId] = [];
    addLog(userId, `Conectando con XIT Cloud Computing...`);

    // Respuesta instantánea al frontend
    res.status(200).json({ success: true, message: 'Despliegue en proceso.' });

    // Ejecución en segundo plano
    deployBotInBackground(userId, githubUrl);
});

app.get('/api/logs/:userId', (req, res) => {
    const userId = req.params.userId;
    const logs = botLogs[userId] || ["Esperando respuesta de la terminal..."];
    res.json({ logs });
});

app.post('/api/stop', (req, res) => {
    const { userId } = req.body;
    if (activeBots[userId]) {
        activeBots[userId].kill();
        delete activeBots[userId];
        addLog(userId, `Bot apagado por orden del usuario o finalización de plan.`);
        res.json({ success: true, message: 'Bot detenido exitosamente.' });
    } else {
        res.status(404).json({ error: 'No hay bot activo.' });
    }
});

app.listen(PORT, () => console.log(`Servidor maestro corriendo en el puerto ${PORT}`));
