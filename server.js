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

app.get("/alunos/:coordenadorId", async (req, res) => {

  try {

    const coordenadorId = req.params.coordenadorId;

    const resultado = await pool.query(
      `
      SELECT
        a.id,
        u.nome
      FROM alunos a
      JOIN usuarios u
          ON a.usuario_id = u.id
      WHERE a.coordenador_id = $1
      ORDER BY u.nome;
      `,
      [coordenadorId]
    );

    res.json(resultado.rows);

  } catch (erro) {

    console.error(erro);

    res.status(500).json({
      erro: "Erro ao buscar alunos"
    });

  }

});

app.post("/resultados", async (req, res) => {

    try {

        const dados = req.body;

        for (const aluno of dados) {

            await pool.query(
                `
                INSERT INTO resultados_mensais
                (
                    aluno_id,
                    mes,
                    checkin,
                    tma,
                    interacao_matinal,
                    checkin_8,
                    analise_dados,
                    olhar_estrategico,
                    analise_carteira
                )
                VALUES
                ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                `,
                [
                    aluno.aluno_id,
                    "Abril",
                    aluno.checkin,
                    aluno.tma,
                    aluno.interacao_matinal,
                    aluno.checkin_8,
                    aluno.analise_dados,
                    aluno.olhar_estrategico,
                    aluno.analise_carteira
                ]
            );

        }

        res.json({
            mensagem: "Dados salvos com sucesso"
        });

    } catch (erro) {

        console.error(erro);

        res.status(500).json({
            erro: "Erro ao salvar"
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