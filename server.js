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

function calcularRank(totalMedalhas) {

    const ranks = [
        "Bronze",
        "Prata",
        "Ouro",
        "Platina",
        "Diamante",
        "Mestre",
        "Lendário"
    ];

    let indice = Math.floor(totalMedalhas / 4);

    if (indice > 6) {
        indice = 6;
    }

    return ranks[indice];

}

function medalhasNoRank(totalMedalhas) {

    return totalMedalhas % 4;

}

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
        medalhas,
        medalhasExtra
    };

}

// =====================
// ROTAS
// =====================

// Teste
app.get("/", (req, res) => {
  res.send("Servidor funcionando");
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

    let alunoId = null;

    if (usuario.perfil === "aluno") {

        const aluno = await pool.query(
            `
            SELECT id
            FROM alunos
            WHERE usuario_id = $1
            `,
            [usuario.id]
        );

        if (aluno.rows.length > 0) {
            alunoId = aluno.rows[0].id;
        }

    }

    if (usuario.senha !== senha) {
      return res.status(401).json({
        erro: "Senha incorreta"
      });
    }

    res.json({
      id: usuario.id,
      aluno_id: alunoId,
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
    
            await pool.query(
              `
              INSERT INTO progresso_missoes
              (
                  aluno_id,
                  mes,
                  lideranca1,
                  lideranca2,
                  tino1,
                  tino2,
                  extra1,
                  medalhas_ganhas,
                  medalhas_extra_ganhas
              )
              VALUES
              ($1,$2,$3,$4,$5,$6,$7,$8,$9)
              `,
              [
                  aluno.aluno_id,
                  "Abril",
                  resultadoMissoes.lideranca1,
                  resultadoMissoes.lideranca2,
                  resultadoMissoes.tino1,
                  resultadoMissoes.tino2,
                  resultadoMissoes.extra,
                  resultadoMissoes.medalhas
              ]
            );

            await pool.query(
              `
              UPDATE alunos
              SET qtd_medalhas =
                  qtd_medalhas + $1
              WHERE id = $2
              `,
              [
                  resultadoMissoes.medalhas,
                  resultadoMissoes.medalhasExtra,
                  aluno.aluno_id
              ]
          );
          const soma = await pool.query(
            `
            SELECT SUM(medalhas_ganhas) AS total
            FROM progresso_missoes
            WHERE aluno_id = $1
            `,
            [aluno.aluno_id]
          );
  
          const totalMedalhas =
            Number(soma.rows[0].total || 0);
          const rank =
            calcularRank(totalMedalhas);
            await pool.query(
              `
              UPDATE alunos
              SET
                  rank_atual = $1,
                  qtd_medalhas = $2
              WHERE id = $3
              `,
              [
                  rank,
                  totalMedalhas,
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

app.get("/progresso/:alunoId", async (req, res) => {

    try {

        const alunoId = req.params.alunoId;

        const aluno = await pool.query(
            `
            SELECT
                rank_atual,
                qtd_medalhas
            FROM alunos
            WHERE id = $1
            `,
            [alunoId]
        );

        const progresso = await pool.query(
            `
            SELECT *
            FROM progresso_missoes
            WHERE aluno_id = $1
            AND mes = 'Abril'
            `,
            [alunoId]
        );

        const resultados = await pool.query(
            `
            SELECT *
            FROM resultados_mensais
            WHERE aluno_id = $1
            AND mes = 'Abril'
            `,
            [alunoId]
        );

        res.json({
            aluno: aluno.rows[0],
            progresso: progresso.rows[0],
            resultados: resultados.rows[0]
        });

    } catch (erro) {

        console.error(erro);

        res.status(500).json({
            erro: "Erro ao buscar progresso"
        });

    }

});

app.get("/progresso/:alunoId", async (req, res) => {

    try {

        const alunoId = req.params.alunoId;

        // Dados do aluno
        const aluno = await pool.query(
            `
            SELECT
                rank_atual,
                qtd_medalhas
            FROM alunos
            WHERE id = $1
            `,
            [alunoId]
        );

        // Missões
        const progresso = await pool.query(
            `
            SELECT *
            FROM progresso_missoes
            WHERE aluno_id = $1
            `,
            [alunoId]
        );

        // Resultados
        const resultados = await pool.query(
            `
            SELECT *
            FROM resultados_mensais
            WHERE aluno_id = $1
            `,
            [alunoId]
        );

        res.json({
            aluno: aluno.rows[0],
            progresso: progresso.rows,
            resultados: resultados.rows
        });

    } catch (erro) {

        console.error(erro);

        res.status(500).json({
            erro: "Erro ao buscar progresso"
        });

    }

});

// =====================
// ROTA: USAR MEDALHA EXTRA
// =====================
app.post("/usar-medalha-extra", async (req, res) => {
  try {
    const { aluno_id } = req.body;

    if (!aluno_id) {
      return res.status(400).json({ erro: "ID do aluno não fornecido" });
    }

    // 1. Calcular medalhas extras ganhas (pela sua coluna real: medalhas_ganhas)
    const ganhas = await pool.query(
      `
      SELECT
        COALESCE(SUM(medalhas_ganhas), 0) AS total
      FROM progresso_missoes
      WHERE aluno_id = $1
      `,
      [aluno_id]
    );

    // 2. Calcular medalhas extras utilizadas
    const usadas = await pool.query(
      `
      SELECT
        COALESCE(SUM(quantidade), 0) AS total
      FROM medalhas_extras_utilizadas
      WHERE aluno_id = $1
      `,
      [aluno_id]
    );

    // 3. Calcular saldo
    const saldo =
      Number(ganhas.rows[0].total) -
      Number(usadas.rows[0].total);

    // 4. Verificar saldo
    if (saldo <= 0) {
      return res.status(400).json({
        erro: "Sem medalhas extras disponíveis"
      });
    }

    // 5. Registrar utilização
    await pool.query(
      `
      INSERT INTO medalhas_extras_utilizadas (aluno_id, quantidade)
      VALUES ($1, $2)
      `,
      [aluno_id, 1]
    );

    // 6. Buscar situação atual do aluno
    const alunoAtual = await pool.query(
      `
      SELECT qtd_medalhas
      FROM alunos
      WHERE id = $1
      `,
      [aluno_id]
    );

    // 7. Adicionar a medalha ao progresso (somar 1)
    const totalMedalhas =
      Number(alunoAtual.rows[0].qtd_medalhas) + 1;

    // 8. Recalcular rank (usando a sua função original que divide por 4)
    const rank = calcularRank(totalMedalhas);

    // 9. Atualizar o aluno
    await pool.query(
      `
      UPDATE alunos
      SET
        rank_atual = $1,
        qtd_medalhas = $2
      WHERE id = $3
      `,
      [rank, totalMedalhas, aluno_id]
    );

    // 10. Resposta final
    res.json({
      mensagem: "Medalha utilizada com sucesso",
      saldo_restante: saldo - 1
    });

  } catch (erro) {
    console.error("Erro ao usar medalha extra:", erro);
    res.status(500).json({
      erro: "Erro interno ao processar o uso da medalha extra"
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