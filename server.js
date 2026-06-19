const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();

// Middleware
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
// FUNÇÕES AUXILIARES
// =====================

function calcularRank(totalMedalhas) {
    const ranks = ["Bronze", "Prata", "Ouro", "Platina", "Diamante", "Mestre", "Lendário"];
    let indice = Math.floor(totalMedalhas / 4);
    if (indice > 6) indice = 6;
    return ranks[indice];
}

function medalhasNoRank(totalMedalhas) {
    return totalMedalhas % 4;
}

// Formata TMA (ex: 3.8 -> "03:48")
function formatarTMA(tma) {
    if (!tma && tma !== 0) return "00:00";
    const horas = Math.floor(tma);
    const minutos = Math.round((tma - horas) * 60);
    return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;
}

// Calcula a largura da barra do Check-in 8:00
function calcularLarguraCheckin8(checkin8) {
    if (!checkin8) return 0;
    const [h, m] = checkin8.split(':').map(Number);
    const minutos = h * 60 + m;
    // Se foi às 8:00 (480 min) ou antes, 100%. 
    // A cada 1h de atraso, perde 10% de largura.
    if (minutos <= 480) return 100;
    return Math.max(0, 100 - ((minutos - 480) / 60) * 10);
}

// Calcula missões do mês (usado pelo POST)
function calcularMissoesAbril(aluno) {
    let medalhas = 0;

    const checkin = Number(String(aluno.checkin).replace("%", "").replace(",", "."));
    const tma = Number(aluno.tma);
    const lideranca1 = checkin >= 90 && tma >= 3.5;
    if (lideranca1) medalhas++;

    const matinal = Number(aluno.interacao_matinal);
    const lideranca2 = matinal >= 1 && aluno.checkin_8 <= "08:05";
    if (lideranca2) medalhas++;

    const tino1 = aluno.analise_dados === true;
    if (tino1) medalhas++;

    const tino2 = aluno.olhar_estrategico === true;
    if (tino2) medalhas++;

    const extra1 = aluno.analise_carteira === true;
    if (extra1) medalhas++;

    return { lideranca1, lideranca2, tino1, tino2, extra1, medalhas };
}

// =====================
// ROTAS
// =====================

app.get("/", (req, res) => {
  res.send("Servidor funcionando");
});

app.post("/login", async (req, res) => {
  try {
    const { email, senha } = req.body;
    const resultado = await pool.query("SELECT * FROM usuarios WHERE email = $1", [email]);

    if (resultado.rows.length === 0) {
      return res.status(401).json({ erro: "Usuário não encontrado" });
    }

    const usuario = resultado.rows[0];
    let alunoId = null;

    if (usuario.perfil === "aluno") {
        const aluno = await pool.query(
            `SELECT id FROM alunos WHERE usuario_id = $1`,
            [usuario.id]
        );
        if (aluno.rows.length > 0) {
            alunoId = aluno.rows[0].id;
        }
    }

    if (usuario.senha !== senha) {
      return res.status(401).json({ erro: "Senha incorreta" });
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
    res.status(500).json({ erro: "Erro interno do servidor" });
  }
});

app.get("/alunos/:coordenadorId", async (req, res) => {
  try {
    const coordenadorId = req.params.coordenadorId;
    const resultado = await pool.query(
      `
      SELECT a.id, u.nome
      FROM alunos a
      JOIN usuarios u ON a.usuario_id = u.id
      WHERE a.coordenador_id = $1
      ORDER BY u.nome;
      `,
      [coordenadorId]
    );
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: "Erro ao buscar alunos" });
  }
});

app.post("/resultados", async (req, res) => {
    try {
        const dados = req.body;

        for (const aluno of dados) {
            await pool.query(
                `
                INSERT INTO resultados_mensais
                (aluno_id, mes, checkin, tma, interacao_matinal, checkin_8, analise_dados, olhar_estrategico, analise_carteira)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
            
            const resultadoMissoes = calcularMissoesAbril(aluno);

            await pool.query(
              `
              INSERT INTO progresso_missoes
              (aluno_id, mes, lideranca1, lideranca2, tino1, tino2, extra1, medalhas_ganhas)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
              `,
              [
                  aluno.aluno_id,
                  "Abril",
                  resultadoMissoes.lideranca1,
                  resultadoMissoes.lideranca2,
                  resultadoMissoes.tino1,
                  resultadoMissoes.tino2,
                  resultadoMissoes.extra1,
                  resultadoMissoes.medalhas
              ]
            );

            const soma = await pool.query(
              `SELECT SUM(medalhas_ganhas) AS total FROM progresso_missoes WHERE aluno_id = $1`,
              [aluno.aluno_id]
            );
  
            const totalMedalhas = Number(soma.rows[0].total || 0);
            const rank = calcularRank(totalMedalhas);

            await pool.query(
              `UPDATE alunos SET rank_atual = $1, qtd_medalhas = $2 WHERE id = $3`,
              [rank, totalMedalhas, aluno.aluno_id]
            );
        }

        res.json({ mensagem: "Dados salvos com sucesso" });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: "Erro ao salvar" });
    }
});

// =====================
// ROTA DE PROGRESSO CORRIGIDA (COM DADOS ENRIQUECIDOS)
// =====================
app.get("/progresso/:alunoId", async (req, res) => {
    try {
        const alunoId = req.params.alunoId;
        const mes = req.query.mes || 'Abril'; // Permite selecionar o mês via query string

        // 1. Dados do aluno
        const aluno = await pool.query(
            `SELECT rank_atual, qtd_medalhas FROM alunos WHERE id = $1`,
            [alunoId]
        );

        // 2. Resultados crus do mês
        const resultados = await pool.query(
            `SELECT * FROM resultados_mensais WHERE aluno_id = $1 AND mes = $2`,
            [alunoId, mes]
        );

        // 3. Progresso das missões (booleanos) do mês
        const progresso = await pool.query(
            `SELECT * FROM progresso_missoes WHERE aluno_id = $1 AND mes = $2`,
            [alunoId, mes]
        );

        const alunoData = aluno.rows[0] || {};
        const resultData = resultados.rows[0] || {};
        const progData = progresso.rows[0] || {};

        // ── CÁLCULOS E FORMATAÇÃO ──

        // Liderança 1
        const checkinRaw = resultData.checkin || "0%";
        const checkinNum = Number(String(checkinRaw).replace("%", "").replace(",", ".")) || 0;
        const tmaNum = Number(resultData.tma) || 0;
        const lideranca1CheckinLargura = Math.min(checkinNum, 100);
        const lideranca1TmaLargura = Math.min((tmaNum / 4) * 100, 100); // Considera 4h como 100%

        // Liderança 2
        const matinalNum = Number(resultData.interacao_matinal) || 0;
        const checkin8Val = resultData.checkin_8 || "00:00";
        const lideranca2MatinalLargura = matinalNum >= 1 ? 100 : 10;
        const lideranca2CheckinLargura = calcularLarguraCheckin8(checkin8Val);

        // Tino Comercial e Medalhas Extras
        const tino1Concluida = progData.tino1 || false;
        const tino2Concluida = progData.tino2 || false;
        const extra1Concluida = progData.extra1 || false;
        // Nota: extra2 não existe em `progresso_missoes` ainda, mas o HTML pede. Iniciamos como false.
        const extra2Concluida = false; 

        // ── MONTAGEM DO JSON ENRIQUECIDO ──
        res.json({
            aluno: {
                rank_atual: alunoData.rank_atual || "Bronze",
                qtd_medalhas: Number(alunoData.qtd_medalhas) || 0
            },
            progresso: {
                // Missão Liderança 1
                lideranca1_concluida: progData.lideranca1 || false,
                lideranca1_checkins_valor: `${Math.round(lideranca1CheckinLargura)}%`,
                lideranca1_checkins_largura: lideranca1CheckinLargura,
                lideranca1_tempo_valor: formatarTMA(tmaNum),
                lideranca1_tempo_largura: lideranca1TmaLargura,

                // Missão Liderança 2
                lideranca2_concluida: progData.lideranca2 || false,
                lideranca2_matinal_valor: `${matinalNum}/1`,
                lideranca2_matinal_largura: lideranca2MatinalLargura,
                lideranca2_checkin_valor: checkin8Val,
                lideranca2_checkin_largura: lideranca2CheckinLargura,

                // Missão Tino 1
                tino1_concluida: tino1Concluida,
                tino1_analise_valor: tino1Concluida ? "1/1" : "0/1",
                tino1_analise_largura: tino1Concluida ? 100 : 10,
                tino1_tip_texto: tino1Concluida ? "Ótimo! Você quantificou os potenciais dos clientes." : "Foque em quantificar os potenciais dos clientes.",

                // Missão Tino 2
                tino2_concluida: tino2Concluida,
                tino2_estrategico_valor: tino2Concluida ? "1/1" : "0/1",
                tino2_estrategico_largura: tino2Concluida ? 100 : 10,
                tino2_tip_texto: tino2Concluida ? "Excelente! Resultados quantificados com sucesso." : "Ao executar, lembre-se de quantificar os resultados.",

                // Missão Extra 1
                extra1_concluida: extra1Concluida,
                extra1_analise_valor: extra1Concluida ? "1/1" : "0/1",
                extra1_analise_largura: extra1Concluida ? 100 : 10,
                extra1_tip_texto: extra1Concluida ? "Ótimo! Você focou em quantificar os potenciais dos clientes." : "Foque em quantificar os potenciais dos clientes.",

                // Missão Extra 2 (criada para atender ao HTML)
                extra2_concluida: extra2Concluida,
                extra2_estrategico_valor: extra2Concluida ? "1/1" : "0/1",
                extra2_estrategico_largura: extra2Concluida ? 100 : 10,
                extra2_tip_texto: extra2Concluida ? "Excelente! Lembre-se de quantificar." : "Ao executar, lembre-se de quantificar os resultados."
            }
        });

    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: "Erro ao buscar progresso" });
    }
});

// =====================
// SERVIDOR
// =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});