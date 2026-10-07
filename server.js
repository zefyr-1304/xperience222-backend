const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = 3000;

const DB_PATH = path.join(__dirname, "xperience222.db");

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database(DB_PATH);

// ======================================================
// FUNCIONES AUXILIARES
// ======================================================

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({
                id: this.lastID,
                changes: this.changes
            });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function normalizarCodigo(codigo) {
    return String(codigo || "").trim().toUpperCase();
}

function respuestaError(res, mensaje, error = null) {
    console.error(mensaje, error || "");
    return res.status(500).json({
        ok: false,
        error: mensaje
    });
}

// ======================================================
// INICIALIZAR BASE DE DATOS
// ======================================================

async function inicializarBaseDatos() {
    try {

        // ----------------------------------------------
        // CONFIGURACION
        // ----------------------------------------------

        await run(`
            CREATE TABLE IF NOT EXISTS configuracion (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                membresias_activas INTEGER DEFAULT 1
            )
        `);

        await run(`
            INSERT OR IGNORE INTO configuracion
            (id, membresias_activas)
            VALUES (1, 1)
        `);

        // ----------------------------------------------
        // PROVEEDORES
        // ----------------------------------------------

        await run(`
            CREATE TABLE IF NOT EXISTS proveedores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL UNIQUE,
                activo INTEGER DEFAULT 1,
                fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // ----------------------------------------------
        // CLIENTES
        // ----------------------------------------------

        await run(`
            CREATE TABLE IF NOT EXISTS clientes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL,
                apellido TEXT,
                telefono TEXT,
                email TEXT,
                fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // ----------------------------------------------
        // MEMBRESIAS
        // ----------------------------------------------

        await run(`
            CREATE TABLE IF NOT EXISTS membresias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                codigo TEXT UNIQUE NOT NULL,
                cliente_id INTEGER,
                proveedor_id INTEGER,
                proveedor TEXT,
                estado TEXT DEFAULT 'Disponible',
                fecha_inicio DATETIME,
                fecha_vencimiento DATETIME,
                fecha_venta DATETIME,
                fecha_activacion DATETIME,
                fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(cliente_id) REFERENCES clientes(id),
                FOREIGN KEY(proveedor_id) REFERENCES proveedores(id)
            )
        `);

        // ----------------------------------------------
        // HISTORIAL
        // ----------------------------------------------

        await run(`
            CREATE TABLE IF NOT EXISTS historial (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                codigo TEXT,
                accion TEXT,
                detalle TEXT,
                fecha DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // ----------------------------------------------
        // INDICES
        // ----------------------------------------------

        await run(`
            CREATE INDEX IF NOT EXISTS idx_membresias_codigo
            ON membresias(codigo)
        `);

        await run(`
            CREATE INDEX IF NOT EXISTS idx_membresias_proveedor
            ON membresias(proveedor_id)
        `);

        await run(`
            CREATE INDEX IF NOT EXISTS idx_membresias_cliente
            ON membresias(cliente_id)
        `);

        console.log("Base de datos inicializada correctamente.");

    } catch (error) {
        console.error("Error inicializando base de datos:", error);
        throw error;
    }
}

// ======================================================
// CONFIGURACION GENERAL
// ======================================================

app.get("/api/configuracion/membresias", async (req, res) => {

    try {

        const config = await get(`
            SELECT membresias_activas
            FROM configuracion
            WHERE id = 1
        `);

        res.json({
            ok: true,
            activas: !!config.membresias_activas
        });

    } catch (error) {
        respuestaError(res, "No se pudo obtener la configuración", error);
    }

});

app.post("/api/configuracion/membresias", async (req, res) => {

    try {

        const activas = req.body.activas ? 1 : 0;

        await run(`
            UPDATE configuracion
            SET membresias_activas = ?
            WHERE id = 1
        `, [activas]);

        res.json({
            ok: true,
            activas: !!activas
        });

    } catch (error) {
        respuestaError(res, "No se pudo actualizar la configuración", error);
    }

});

// ======================================================
// DASHBOARD
// ======================================================

app.get("/api/dashboard", async (req, res) => {

    try {

        const total = await get(`
            SELECT COUNT(*) AS total
            FROM membresias
        `);

        const disponibles = await get(`
            SELECT COUNT(*) AS total
            FROM membresias
            WHERE estado = 'Disponible'
        `);

        const vendidas = await get(`
            SELECT COUNT(*) AS total
            FROM membresias
            WHERE estado IN ('Vendida', 'Vendido')
        `);

        const activas = await get(`
            SELECT COUNT(*) AS total
            FROM membresias
            WHERE estado = 'Activa'
        `);

        const proveedores = await get(`
            SELECT COUNT(*) AS total
            FROM proveedores
        `);

        const proveedoresActivos = await get(`
            SELECT COUNT(*) AS total
            FROM proveedores
            WHERE activo = 1
        `);

        res.json({
            ok: true,
            total: total.total,
            disponibles: disponibles.total,
            vendidas: vendidas.total,
            activas: activas.total,
            proveedores: proveedores.total,
            proveedoresActivos: proveedoresActivos.total
        });

    } catch (error) {
        respuestaError(res, "No se pudo cargar el dashboard", error);
    }

});

// ======================================================
// PROVEEDORES
// ======================================================

app.get("/api/proveedores", async (req, res) => {

    try {

        const proveedores = await all(`
            SELECT
                p.id,
                p.nombre,
                p.activo,
                p.fecha_registro,

                COUNT(m.id) AS total_membresias,

                SUM(
                    CASE
                        WHEN m.estado = 'Disponible'
                        THEN 1
                        ELSE 0
                    END
                ) AS disponibles,

                SUM(
                    CASE
                        WHEN m.estado IN ('Vendida', 'Vendido')
                        THEN 1
                        ELSE 0
                    END
                ) AS vendidas,

                SUM(
                    CASE
                        WHEN m.estado = 'Activa'
                        THEN 1
                        ELSE 0
                    END
                ) AS activas

            FROM proveedores p

            LEFT JOIN membresias m
                ON m.proveedor_id = p.id

            GROUP BY p.id

            ORDER BY p.nombre ASC
        `);

        res.json(proveedores);

    } catch (error) {
        respuestaError(res, "No se pudieron cargar los proveedores", error);
    }

});

// ======================================================
// CREAR PROVEEDOR
// ======================================================

app.post("/api/proveedores", async (req, res) => {

    try {

        const nombre = String(req.body.nombre || "").trim();

        if (!nombre) {
            return res.status(400).json({
                ok: false,
                error: "El nombre del proveedor es obligatorio"
            });
        }

        const existente = await get(`
            SELECT *
            FROM proveedores
            WHERE LOWER(nombre) = LOWER(?)
        `, [nombre]);

        if (existente) {
            return res.status(400).json({
                ok: false,
                error: "El proveedor ya existe",
                proveedor: existente
            });
        }

        const resultado = await run(`
            INSERT INTO proveedores
            (nombre, activo)
            VALUES (?, 1)
        `, [nombre]);

        const proveedorId = resultado.id;

        // Generar 100 códigos automáticamente
        const generados = await generarCodigos(proveedorId, 100);

        const proveedor = await get(`
            SELECT *
            FROM proveedores
            WHERE id = ?
        `, [proveedorId]);

        res.json({
            ok: true,
            proveedor,
            creados: generados
        });

    } catch (error) {
        respuestaError(res, "No se pudo crear el proveedor", error);
    }

});

// ======================================================
// ACTIVAR / DESACTIVAR PROVEEDOR
// ======================================================

app.post("/api/proveedores/:id/estado", async (req, res) => {

    try {

        const id = Number(req.params.id);

        const proveedor = await get(`
            SELECT *
            FROM proveedores
            WHERE id = ?
        `, [id]);

        if (!proveedor) {
            return res.status(404).json({
                ok: false,
                error: "Proveedor no encontrado"
            });
        }

        const nuevoEstado = proveedor.activo ? 0 : 1;

        await run(`
            UPDATE proveedores
            SET activo = ?
            WHERE id = ?
        `, [nuevoEstado, id]);

        res.json({
            ok: true,
            activo: !!nuevoEstado
        });

    } catch (error) {
        respuestaError(res, "No se pudo cambiar el estado del proveedor", error);
    }

});

// ======================================================
// GENERAR CODIGOS
// ======================================================

async function generarCodigos(proveedorId, cantidad) {

    const proveedor = await get(`
        SELECT *
        FROM proveedores
        WHERE id = ?
    `, [proveedorId]);

    if (!proveedor) {
        throw new Error("Proveedor no encontrado");
    }

    cantidad = Math.min(Number(cantidad) || 100, 5000);

    const ultimo = await get(`
        SELECT codigo
        FROM membresias
        WHERE codigo LIKE 'X222-%'
        ORDER BY id DESC
        LIMIT 1
    `);

    let numero = 1;

    if (ultimo && ultimo.codigo) {

        const partes = ultimo.codigo.split("-");

        const ultimoNumero = parseInt(partes[1], 10);

        if (!isNaN(ultimoNumero)) {
            numero = ultimoNumero + 1;
        }

    }

    let creados = 0;

    for (let i = 0; i < cantidad; i++) {

        const codigo = `X222-${String(numero).padStart(6, "0")}`;

        try {

            await run(`
                INSERT INTO membresias
                (
                    codigo,
                    proveedor_id,
                    proveedor,
                    estado
                )
                VALUES (?, ?, ?, 'Disponible')
            `, [
                codigo,
                proveedor.id,
                proveedor.nombre
            ]);

            creados++;

        } catch (error) {

            // Si ya existe, continuar
            if (!String(error.message).includes("UNIQUE")) {
                throw error;
            }

        }

        numero++;
    }

    return creados;
}

app.post("/api/proveedores/:id/generar", async (req, res) => {

    try {

        const id = Number(req.params.id);

        const cantidad = Number(req.body.cantidad || 100);

        const creados = await generarCodigos(id, cantidad);

        res.json({
            ok: true,
            creados
        });

    } catch (error) {
        respuestaError(res, "No se pudieron generar los códigos", error);
    }

});

// ======================================================
// MEMBRESIAS DE UN PROVEEDOR
// ======================================================

app.get("/api/proveedores/:id/membresias", async (req, res) => {

    try {

        const id = Number(req.params.id);

        const membresias = await all(`
            SELECT
                m.*,

                c.nombre AS cliente_nombre,
                c.apellido AS cliente_apellido,
                c.telefono AS cliente_telefono,
                c.email AS cliente_email

            FROM membresias m

            LEFT JOIN clientes c
                ON c.id = m.cliente_id

            WHERE m.proveedor_id = ?

            ORDER BY m.id ASC
        `, [id]);

        res.json(membresias);

    } catch (error) {
        respuestaError(res, "No se pudieron cargar las membresías", error);
    }

});

// ======================================================
// CLIENTES
// ======================================================

app.get("/api/clientes", async (req, res) => {

    try {

        const clientes = await all(`
            SELECT *
            FROM clientes
            ORDER BY nombre ASC, apellido ASC
        `);

        res.json(clientes);

    } catch (error) {
        respuestaError(res, "No se pudieron cargar los clientes", error);
    }

});

app.post("/api/clientes", async (req, res) => {

    try {

        const nombre = String(req.body.nombre || "").trim();
        const apellido = String(req.body.apellido || "").trim();
        const telefono = String(req.body.telefono || "").trim();
        const email = String(req.body.email || "").trim();

        if (!nombre) {
            return res.status(400).json({
                ok: false,
                error: "El nombre es obligatorio"
            });
        }

        const resultado = await run(`
            INSERT INTO clientes
            (
                nombre,
                apellido,
                telefono,
                email
            )
            VALUES (?, ?, ?, ?)
        `, [
            nombre,
            apellido,
            telefono,
            email
        ]);

        const cliente = await get(`
            SELECT *
            FROM clientes
            WHERE id = ?
        `, [resultado.id]);

        res.json({
            ok: true,
            cliente
        });

    } catch (error) {
        respuestaError(res, "No se pudo registrar el cliente", error);
    }

});

// ======================================================
// ASIGNAR MEMBRESIA A CLIENTE
// ======================================================

app.post("/api/membresias/asignar", async (req, res) => {

    try {

        const codigo = normalizarCodigo(req.body.codigo);
        const clienteId = Number(req.body.cliente_id);

        if (!codigo || !clienteId) {
            return res.status(400).json({
                ok: false,
                error: "Código y cliente son obligatorios"
            });
        }

        const membresia = await get(`
            SELECT *
            FROM membresias
            WHERE codigo = ?
        `, [codigo]);

        if (!membresia) {
            return res.status(404).json({
                ok: false,
                error: "Membresía no encontrada"
            });
        }

        const cliente = await get(`
            SELECT *
            FROM clientes
            WHERE id = ?
        `, [clienteId]);

        if (!cliente) {
            return res.status(404).json({
                ok: false,
                error: "Cliente no encontrado"
            });
        }

        await run(`
            UPDATE membresias
            SET
                cliente_id = ?,
                estado = 'Vendida',
                fecha_venta = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [
            clienteId,
            membresia.id
        ]);

        await run(`
            INSERT INTO historial
            (
                codigo,
                accion,
                detalle
            )
            VALUES (?, ?, ?)
        `, [
            codigo,
            "ASIGNACION",
            `Asignada al cliente ${cliente.nombre} ${cliente.apellido || ""}`
        ]);

        res.json({
            ok: true,
            mensaje: "Membresía asignada correctamente"
        });

    } catch (error) {
        respuestaError(res, "No se pudo asignar la membresía", error);
    }

});

// ======================================================
// TODAS LAS MEMBRESIAS
// ======================================================

app.get("/api/membresias", async (req, res) => {

    try {

        const membresias = await all(`
            SELECT
                m.*,

                c.nombre AS cliente_nombre,
                c.apellido AS cliente_apellido,
                c.telefono AS cliente_telefono,
                c.email AS cliente_email

            FROM membresias m

            LEFT JOIN clientes c
                ON c.id = m.cliente_id

            ORDER BY m.id ASC
        `);

        res.json(membresias);

    } catch (error) {
        respuestaError(res, "No se pudieron cargar las membresías", error);
    }

});

// ======================================================
// VALIDAR CODIGO
// ======================================================

app.get("/api/validar/:codigo", async (req, res) => {

    try {

        const codigo = normalizarCodigo(req.params.codigo);

        const membresia = await get(`
            SELECT
                m.*,

                p.nombre AS proveedor_nombre,
                p.activo AS proveedor_activo,

                c.nombre AS cliente_nombre,
                c.apellido AS cliente_apellido

            FROM membresias m

            LEFT JOIN proveedores p
                ON p.id = m.proveedor_id

            LEFT JOIN clientes c
                ON c.id = m.cliente_id

            WHERE m.codigo = ?
        `, [codigo]);

        if (!membresia) {

            return res.status(404).json({
                ok: false,
                valida: false,
                error: "Código no encontrado"
            });

        }

        const config = await get(`
            SELECT membresias_activas
            FROM configuracion
            WHERE id = 1
        `);

        if (!config.membresias_activas) {

            return res.status(403).json({
                ok: false,
                valida: false,
                error: "El sistema de membresías está apagado"
            });

        }

        if (!membresia.proveedor_activo) {

            return res.status(403).json({
                ok: false,
                valida: false,
                error: "El proveedor está desactivado"
            });

        }

        if (
            membresia.estado === "Cancelada" ||
            membresia.estado === "Vencida"
        ) {

            return res.status(403).json({
                ok: false,
                valida: false,
                error: "La membresía no está activa",
                membresia
            });

        }

        res.json({
            ok: true,
            valida: true,
            membresia
        });

    } catch (error) {
        respuestaError(res, "No se pudo validar el código", error);
    }

});

// ======================================================
// REGISTRO MANUAL DE MEMBRESIA
// COMPATIBILIDAD CON LA VERSION ANTERIOR
// ======================================================

app.post("/api/registrar", async (req, res) => {

    try {

        const codigo = normalizarCodigo(req.body.codigo);
        const proveedorNombre = String(req.body.proveedor || "").trim();
        const clienteNombre = String(req.body.cliente || "").trim();
        const estado = String(req.body.estado || "Disponible").trim();

        if (!codigo) {
            return res.status(400).json({
                ok: false,
                error: "El código es obligatorio"
            });
        }

        // Verificar código existente
        const existente = await get(`
            SELECT *
            FROM membresias
            WHERE codigo = ?
        `, [codigo]);

        if (existente) {
            return res.status(400).json({
                ok: false,
                error: "El código ya existe"
            });
        }

        let proveedorId = null;

        if (proveedorNombre) {

            let proveedor = await get(`
                SELECT *
                FROM proveedores
                WHERE LOWER(nombre) = LOWER(?)
            `, [proveedorNombre]);

            if (!proveedor) {

                const resultadoProveedor = await run(`
                    INSERT INTO proveedores
                    (
                        nombre,
                        activo
                    )
                    VALUES (?, 1)
                `, [proveedorNombre]);

                proveedorId = resultadoProveedor.id;

            } else {

                proveedorId = proveedor.id;

            }

        }

        let clienteId = null;

        if (clienteNombre) {

            const partes = clienteNombre.split(" ");

            const nombre = partes.shift();
            const apellido = partes.join(" ");

            const resultadoCliente = await run(`
                INSERT INTO clientes
                (
                    nombre,
                    apellido
                )
                VALUES (?, ?)
            `, [
                nombre,
                apellido
            ]);

            clienteId = resultadoCliente.id;
        }

        await run(`
            INSERT INTO membresias
            (
                codigo,
                proveedor_id,
                proveedor,
                cliente_id,
                estado
            )
            VALUES (?, ?, ?, ?, ?)
        `, [
            codigo,
            proveedorId,
            proveedorNombre,
            clienteId,
            estado
        ]);

        await run(`
            INSERT INTO historial
            (
                codigo,
                accion,
                detalle
            )
            VALUES (?, ?, ?)
        `, [
            codigo,
            "REGISTRO",
            "Membresía registrada manualmente"
        ]);

        res.json({
            ok: true,
            mensaje: "Membresía registrada correctamente"
        });

    } catch (error) {
        respuestaError(res, "No se pudo registrar la membresía", error);
    }

});

// ======================================================
// ACTUALIZAR ESTADO
// ======================================================

app.post("/api/actualizar-estado", async (req, res) => {

    try {

        const codigo = normalizarCodigo(req.body.codigo);
        const estado = String(req.body.estado || "").trim();

        if (!codigo || !estado) {
            return res.status(400).json({
                ok: false,
                error: "Código y estado son obligatorios"
            });
        }

        const estadosPermitidos = [
            "Disponible",
            "Vendida",
            "Vendido",
            "Activa",
            "Vencida",
            "Cancelada"
        ];

        if (!estadosPermitidos.includes(estado)) {
            return res.status(400).json({
                ok: false,
                error: "Estado no permitido"
            });
        }

        const membresia = await get(`
            SELECT *
            FROM membresias
            WHERE codigo = ?
        `, [codigo]);

        if (!membresia) {
            return res.status(404).json({
                ok: false,
                error: "Membresía no encontrada"
            });
        }

        let sql = `
            UPDATE membresias
            SET estado = ?
        `;

        const params = [estado];

        if (estado === "Vendida" || estado === "Vendido") {

            sql += `,
                fecha_venta = CURRENT_TIMESTAMP
            `;

        }

        if (estado === "Activa") {

            sql += `,
                fecha_activacion = CURRENT_TIMESTAMP,
                fecha_inicio = CURRENT_TIMESTAMP
            `;

        }

        sql += `
            WHERE codigo = ?
        `;

        params.push(codigo);

        await run(sql, params);

        await run(`
            INSERT INTO historial
            (
                codigo,
                accion,
                detalle
            )
            VALUES (?, ?, ?)
        `, [
            codigo,
            "CAMBIO_ESTADO",
            `Estado cambiado a ${estado}`
        ]);

        res.json({
            ok: true,
            mensaje: "Estado actualizado correctamente"
        });

    } catch (error) {
        respuestaError(res, "No se pudo actualizar el estado", error);
    }

});

// ======================================================
// ELIMINAR MEMBRESIA
// ======================================================

app.delete("/api/eliminar/:codigo", async (req, res) => {

    try {

        const codigo = normalizarCodigo(req.params.codigo);

        const membresia = await get(`
            SELECT *
            FROM membresias
            WHERE codigo = ?
        `, [codigo]);

        if (!membresia) {

            return res.status(404).json({
                ok: false,
                error: "Membresía no encontrada"
            });

        }

        await run(`
            INSERT INTO historial
            (
                codigo,
                accion,
                detalle
            )
            VALUES (?, ?, ?)
        `, [
            codigo,
            "ELIMINACION",
            "Membresía eliminada"
        ]);

        await run(`
            DELETE FROM membresias
            WHERE codigo = ?
        `, [codigo]);

        res.json({
            ok: true,
            mensaje: "Membresía eliminada correctamente"
        });

    } catch (error) {
        respuestaError(res, "No se pudo eliminar la membresía", error);
    }

});

// ======================================================
// HISTORIAL
// ======================================================

app.get("/api/historial", async (req, res) => {

    try {

        const historial = await all(`
            SELECT *
            FROM historial
            ORDER BY id DESC
        `);

        res.json(historial);

    } catch (error) {
        respuestaError(res, "No se pudo cargar el historial", error);
    }

});

// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/api/health", async (req, res) => {

    res.json({
        ok: true,
        servidor: "Xperience222",
        puerto: PORT,
        fecha: new Date().toISOString()
    });

});

// ======================================================
// PAGINA PRINCIPAL
// ======================================================

app.get("/", (req, res) => {

    res.sendFile(
        path.join(__dirname, "index.html")
    );

});

// ======================================================
// INICIAR SERVIDOR
// ======================================================

inicializarBaseDatos()
    .then(() => {

        app.listen(PORT, () => {

            console.log("--------------------------------------");
            console.log(" XPERIENCE222");
            console.log("--------------------------------------");
            console.log(`Servidor activo en:`);
            console.log(`http://localhost:${PORT}`);
            console.log("--------------------------------------");

        });

    })
    .catch(error => {

        console.error(
            "No se pudo iniciar Xperience222:",
            error
        );

    });