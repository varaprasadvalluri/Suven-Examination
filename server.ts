import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import 'dotenv/config';

import { fileURLToPath } from 'url';
import { PORT } from './server/config';
import healthRouter from './server/routes/health';
import cloudinaryRouter from './server/routes/cloudinary';
import gatekeeperRouter from './server/routes/gatekeeper';
import dbRouter from './server/routes/db';
import authRoutesRouter from './server/routes/authRoutes';
import examsRouter from './server/routes/exams';
import gcpRouter from './server/routes/gcp';
import adminDbRouter from './server/routes/adminDb';
import reportsRouter from './server/routes/reports';


let __dirname, __filename;
try {
  __filename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
  __dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(__filename);
} catch (e) {
  __filename = '';
  __dirname = __dirname || process.cwd();
}


const app = express();

// Default express.json() limit (100kb) is too small for a full merit-list export payload
// (thousands of student rows) — raised for that route without affecting anything else.
app.use(express.json({ limit: '2mb' }));
app.use(healthRouter);
app.use(cloudinaryRouter);
app.use(gatekeeperRouter);
app.use(dbRouter);
app.use(authRoutesRouter);
app.use(examsRouter);
app.use(gcpRouter);
app.use(adminDbRouter);
app.use(reportsRouter);

async function startServer() {
  // Vite server middleware for local reactive dev mode
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log("Vite reactive middleware mounted successfully.");
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // SPA routing fallback
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log("Production static file directory assets distribution ready.");
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[NODE EXPRESS SERVER] Server actively listening at http://localhost:${PORT}`);
  });
}

startServer();
