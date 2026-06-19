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

function calcularMissoesAbril(aluno) {

    let medalhas = 0;

    // =====================
    // MISSÃO LIDERANÇA 1
    // =====================

    const checkin = Number(
        String(aluno.checkin)
            .replace("%", "")
            .replace(",", ".")
    );

    const tma = Number(aluno.tma);

    const lideranca1 =
        checkin >= 90 &&
        tma >= 3.5;

    if (lideranca1) medalhas++;

    // =====================
    // MISSÃO LIDERANÇA 2
    // =====================

    const matinal =
        Number(aluno.interacao_matinal);

    const lideranca2 =
        matinal >= 1 &&
        aluno.checkin_8 <= "08:05";

    if (lideranca2) medalhas++;

    // =====================
    // TINO COMERCIAL 1
    // =====================

    const tino1 =
        aluno.analise_dados === true;

    if (tino1) medalhas++;

    // =====================
    // TINO COMERCIAL 2
    // =====================

    const tino2 =
        aluno.olhar_estrategico === true;

    if (tino2) medalhas++;

    // =====================
    // MEDALHA EXTRA
    // =====================

    const extra =
        aluno.analise_carteira === true;

    if (extra) medalhas++;

    return {
        lideranca1,
        lideranca2,
        tino1,
        tino2,
        extra,
        medalhas
    };

}

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

          console.log(aluno);

              console.log(
                "CHECKBOXES:",
                aluno.analise_dados,
                aluno.olhar_estrategico,
                aluno.analise_carteira
              );

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
                RETURNING *
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
            const resultadoMissoes =
              calcularMissoesAbril(aluno);
    
            console.log(resultadoMissoes);

            await pool.query(
              `
              UPDATE alunos
              SET qtd_medalhas =
                  qtd_medalhas + $1
              WHERE id = $2
              `,
              [
                  resultadoMissoes.medalhas,
                  aluno.aluno_id
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