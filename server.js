const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();

//Middleware

app.use(cors());
app.use(express.json());

// Teste de conexão com banco

pool.query("SELECT NOW()")
  .then((res) => {
    console.log("Conectado ao PostgreSQL!");
    console.log(res.rows);
  })
  .catch((err) => {
    console.error("Erro ao conectar ao PostgreSQL:");
    console.error(err);
  });

// =====================
// ROTAS
// =====================

// Teste
app.get("/", (req, res) => {
  res.send("Servidor funcionando");
});

// Lista de alunos
app.get("/alunos", (req, res) => {
  const alunos = [
    { id: 1, nome: "João" },
    { id: 2, nome: "Maria" }
  ];

  res.json(alunos);
});

// LOGIN (VERSÃO DE TESTE)
app.post("/login", async (req, res) => {
  try {

    const { email, senha } = req.body;

    const resultado = await pool.query(
      "SELECT * FROM usuarios WHERE email = $1",
      [email]
    );

    if (resultado.rows.length === 0) {
      return res.status(401).json({
        erro: "Usuário não encontrado"
      });
    }

    const usuario = resultado.rows[0];

    if (usuario.senha !== senha) {
      return res.status(401).json({
        erro: "Senha incorreta"
      });
    }

    res.json({
      id: usuario.id,
      nome: usuario.nome,
      perfil: usuario.perfil,
      time: usuario.time
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro interno do servidor"
    });
  }
});

// =====================
// SERVIDOR
// =====================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});