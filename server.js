const express = require("express");
const path = require("path");
const cors = require("cors");
const pool = require("./db");

const app = express();
const projectRoot = path.resolve(__dirname, "..", "..");

//Middleware

app.use(cors());
app.use(express.json());
app.use(express.static(projectRoot));

// Teste de conexão com banco

pool
  .query("SELECT NOW()")
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
    "Lendário",
  ];
  const limiteAteMestre = 15; // 3 medalhas × 5 ranks (Bronze até Diamante)

  let indice;
  if (totalMedalhas < limiteAteMestre) {
    indice = Math.floor(totalMedalhas / 3);
  } else {
    const alemDoMestre = totalMedalhas - limiteAteMestre;
    indice = alemDoMestre >= 5 ? 6 : 5; // precisa de 5 (não 3) pra sair de Mestre
  }

  if (indice > 6) indice = 6;
  return ranks[indice];
}

// =====================
// LÓGICA DE ORDEM DOS MESES
// =====================
const MESES_ORDEM = [
  "Abril",
  "Maio",
  "Junho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
];

async function contarAlunosDoCoordenador(coordenadorId) {
  const r = await pool.query(
    `SELECT COUNT(*) as total FROM alunos WHERE coordenador_id = $1`,
    [coordenadorId],
  );
  return Number(r.rows[0].total);
}

async function mesCompleto(coordenadorId, mes, totalAlunos) {
  if (totalAlunos === 0) return true; // coordenador sem alunos: nada pendente

  const r = await pool.query(
    `
    SELECT COUNT(DISTINCT aluno_id) as total
    FROM resultados_mensais
    WHERE mes = $1
    AND aluno_id IN (SELECT id FROM alunos WHERE coordenador_id = $2)
    `,
    [mes, coordenadorId],
  );
  return Number(r.rows[0].total) === totalAlunos;
}

async function statusMeses(coordenadorId) {
  const totalAlunos = await contarAlunosDoCoordenador(coordenadorId);

  const mesesCompletos = [];
  let mesLancavel = MESES_ORDEM[0];

  for (let i = 0; i < MESES_ORDEM.length; i++) {
    const mes = MESES_ORDEM[i];
    const completo = await mesCompleto(coordenadorId, mes, totalAlunos);

    if (completo) {
      mesesCompletos.push(mes);
      mesLancavel = MESES_ORDEM[i + 1] || null; // null = todos os meses já lançados
    } else {
      mesLancavel = mes; // primeiro mês incompleto = o lançável agora
      break;
    }
  }

  const indexLancavel = mesLancavel
    ? MESES_ORDEM.indexOf(mesLancavel)
    : MESES_ORDEM.length;
  const mesesBloqueados = MESES_ORDEM.filter((_, i) => i > indexLancavel);

  return {
    mes_lancavel: mesLancavel,
    meses_completos: mesesCompletos,
    meses_bloqueados: mesesBloqueados,
  };
}

function horaParaMinutos(horaTexto) {
  if (!horaTexto) return null;
  const [h, m] = String(horaTexto).split(":").map(Number);
  return h * 60 + (m || 0);
}
function calcularMissoesDoMes(aluno) {
  let medalhas = 0; // NÃO inclui a medalha extra — ela só conta quando resgatada

  const checkin = Number(
    String(aluno.checkin).replace("%", "").replace(",", "."),
  );
  const tma = Number(aluno.tma);
  const lideranca1 = checkin >= 90 && tma >= 3.5;
  if (lideranca1) medalhas++;

  const matinal = Number(aluno.interacao_matinal);
  const LIMITE_CHECKIN8 = 8 * 60 + 5;
  const lideranca2 =
    matinal >= 1 && horaParaMinutos(aluno.checkin_8) <= LIMITE_CHECKIN8;
  if (lideranca2) medalhas++;

  const tino1 = aluno.analise_dados === true;
  if (tino1) medalhas++;

  const tino2 = aluno.olhar_estrategico === true;
  if (tino2) medalhas++;

  const extra = aluno.analise_carteira === true;
  // extra1 continua sendo gravado normalmente (linha abaixo não muda),
  // só não entra mais na soma de `medalhas`

  return {
    lideranca1,
    lideranca2,
    tino1,
    tino2,
    extra,
    medalhas,
  };
}

// =====================
// ROTAS
// =====================

// Página inicial
app.get("/", (req, res) => {
  res.sendFile(path.join(projectRoot, "index.html"));
});

// LOGIN (VERSÃO DE TESTE)
app.post("/login", async (req, res) => {
  try {
    const { email, senha } = req.body;

    const resultado = await pool.query(
      "SELECT * FROM usuarios WHERE email = $1",
      [email],
    );

    if (resultado.rows.length === 0) {
      return res.status(401).json({
        erro: "Usuário não encontrado",
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
        [usuario.id],
      );

      if (aluno.rows.length > 0) {
        alunoId = aluno.rows[0].id;
      }
    }

    if (usuario.senha !== senha) {
      return res.status(401).json({
        erro: "Senha incorreta",
      });
    }

    res.json({
      id: usuario.id,
      aluno_id: alunoId,
      nome: usuario.nome,
      perfil: usuario.perfil,
      time: usuario.time,
    });
  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro interno do servidor",
    });
  }
});

// ROTA PARA RANKING E GRÁFICO (NÃO TEM O ID DO COORDENADOR NA URL)
// =====================
app.get("/alunos", async (req, res) => {
  try {
    const timeFiltro = req.query.time || "Geral";
    const mesFiltro = req.query.mes || null; // ex: "Abril"

    let condicaoTime = "";
    let params = [];

    if (timeFiltro !== "Geral" && timeFiltro !== "") {
      condicaoTime = "WHERE a.time = $1";
      params = [timeFiltro];
    }

    if (!mesFiltro) {
      const queryAlunos = `
    SELECT a.id, u.nome, a.rank_atual, a.qtd_medalhas, a.time
    FROM alunos a
    JOIN usuarios u ON a.usuario_id = u.id
    ${condicaoTime}
    ORDER BY a.qtd_medalhas DESC, u.nome
  `;
      const resultado = await pool.query(queryAlunos, params);

      const ids = resultado.rows.map((a) => a.id);
      const saldos = await saldosMedalhaExtraEmLote(ids);

      const linhasComSaldo = resultado.rows.map((aluno) => ({
        ...aluno,
        saldo_medalha_extra: saldos[aluno.id] || 0,
      }));

      return res.json(linhasComSaldo);
    }

    // Com mês: soma acumulada de medalhas até (e incluindo) o mês filtrado
    const indexMes = MESES_ORDEM.indexOf(mesFiltro);
    if (indexMes === -1) {
      return res.status(400).json({ erro: "Mês inválido" });
    }
    const mesesAteFiltro = MESES_ORDEM.slice(0, indexMes + 1);
    const paramIndexMeses = params.length + 1;

    const queryAlunos = `
      SELECT
        a.id,
        u.nome,
        a.time,
        COALESCE(SUM(pm.medalhas_ganhas), 0) AS qtd_medalhas
      FROM alunos a
      JOIN usuarios u ON a.usuario_id = u.id
      LEFT JOIN progresso_missoes pm
        ON pm.aluno_id = a.id AND pm.mes = ANY($${paramIndexMeses}::text[])
      ${condicaoTime}
      GROUP BY a.id, u.nome, a.time
      ORDER BY qtd_medalhas DESC, u.nome
    `;
    params.push(mesesAteFiltro);

    const resultado = await pool.query(queryAlunos, params);
    const linhas = resultado.rows.map((aluno) => ({
      ...aluno,
      qtd_medalhas: Number(aluno.qtd_medalhas),
      rank_atual: calcularRank(Number(aluno.qtd_medalhas)),
    }));

    const ids = linhas.map((a) => a.id);
    const saldos = await saldosMedalhaExtraEmLote(ids);

    const linhasComSaldo = linhas.map((aluno) => ({
      ...aluno,
      saldo_medalha_extra: saldos[aluno.id] || 0,
    }));

    res.json(linhasComSaldo);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: "Erro ao buscar alunos" });
  }
});

app.get("/coordenador/resultados/:coordenadorId", async (req, res) => {
  try {
    const coordenadorId = req.params.coordenadorId;
    const mes = req.query.mes;

    if (!mes) {
      return res.status(400).json({ erro: "Mês não especificado" });
    }

    const resultado = await pool.query(
      `
      SELECT
        a.id AS aluno_id,
        u.nome,
        rm.checkin,
        rm.tma,
        rm.interacao_matinal,
        rm.checkin_8,
        rm.analise_dados,
        rm.olhar_estrategico,
        rm.analise_carteira
      FROM alunos a
      JOIN usuarios u ON a.usuario_id = u.id
      LEFT JOIN resultados_mensais rm
        ON rm.aluno_id = a.id AND rm.mes = $2
      WHERE a.coordenador_id = $1
      ORDER BY u.nome
      `,
      [coordenadorId, mes],
    );

    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: "Erro ao buscar dados do mês" });
  }
});

app.post("/resultados", async (req, res) => {
  try {
    const { coordenadorId, mes, dados } = req.body;

    if (!coordenadorId || !mes || !Array.isArray(dados)) {
      return res.status(400).json({
        erro: "Payload inválido: coordenadorId, mes e dados são obrigatórios",
      });
    }

    // 1. Só aceita o mês que realmente está liberado para este coordenador
    const status = await statusMeses(coordenadorId);
    if (status.mes_lancavel !== mes) {
      return res.status(409).json({
        erro: `Não é possível lançar "${mes}". O mês lançável agora é "${status.mes_lancavel || "nenhum — todos os meses já foram lançados"}".`,
      });
    }

    for (const aluno of dados) {
      const existente = await pool.query(
        `SELECT 1 FROM resultados_mensais WHERE aluno_id = $1 AND mes = $2 LIMIT 1`,
        [aluno.aluno_id, mes],
      );

      if (existente.rows.length > 0) {
        await pool.query(
          `
          UPDATE resultados_mensais
          SET checkin = $3,
              tma = $4,
              interacao_matinal = $5,
              checkin_8 = $6,
              analise_dados = $7,
              olhar_estrategico = $8,
              analise_carteira = $9
          WHERE aluno_id = $1 AND mes = $2
          `,
          [
            aluno.aluno_id,
            mes,
            aluno.checkin,
            aluno.tma,
            aluno.interacao_matinal,
            aluno.checkin_8,
            aluno.analise_dados,
            aluno.olhar_estrategico,
            aluno.analise_carteira,
          ],
        );
      } else {
        await pool.query(
          `
                  INSERT INTO resultados_mensais
                  (aluno_id, mes, checkin, tma, interacao_matinal, checkin_8, analise_dados, olhar_estrategico, analise_carteira)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                  RETURNING *
                  `,
          [
            aluno.aluno_id,
            mes,
            aluno.checkin,
            aluno.tma,
            aluno.interacao_matinal,
            aluno.checkin_8,
            aluno.analise_dados,
            aluno.olhar_estrategico,
            aluno.analise_carteira,
          ],
        );
      }

      const resultadoMissoes = calcularMissoesDoMes(aluno);

      await pool.query(
        `DELETE FROM progresso_missoes WHERE aluno_id = $1 AND mes = $2`,
        [aluno.aluno_id, mes],
      );

      await pool.query(
        `
              INSERT INTO progresso_missoes
              (aluno_id, mes, lideranca1, lideranca2, tino1, tino2, extra1, medalhas_ganhas)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
              `,
        [
          aluno.aluno_id,
          mes,
          resultadoMissoes.lideranca1,
          resultadoMissoes.lideranca2,
          resultadoMissoes.tino1,
          resultadoMissoes.tino2,
          resultadoMissoes.extra,
          resultadoMissoes.medalhas,
        ],
      );

      const soma = await pool.query(
        `SELECT SUM(medalhas_ganhas) AS total FROM progresso_missoes WHERE aluno_id = $1`,
        [aluno.aluno_id],
      );

      const totalMedalhas = Number(soma.rows[0].total || 0);
      const rank = calcularRank(totalMedalhas);

      await pool.query(
        `UPDATE alunos SET rank_atual = $1, qtd_medalhas = $2 WHERE id = $3`,
        [rank, totalMedalhas, aluno.aluno_id],
      );
    }

    res.json({ mensagem: "Dados salvos com sucesso", mes });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: "Erro ao salvar" });
  }
});

async function statusMesesAluno(alunoId) {
  const mesesCompletos = [];

  for (const mes of MESES_ORDEM) {
    const r = await pool.query(
      `SELECT 1 FROM resultados_mensais WHERE aluno_id = $1 AND mes = $2 LIMIT 1`,
      [alunoId, mes],
    );
    if (r.rows.length > 0) {
      mesesCompletos.push(mes);
    } else {
      break; // segue a ordem cronológica: para no primeiro mês sem dados
    }
  }

  const ultimoIndex = mesesCompletos.length - 1;
  const mesesBloqueados = MESES_ORDEM.filter((_, i) => i > ultimoIndex);

  return { meses_completos: mesesCompletos, meses_bloqueados: mesesBloqueados };
}

async function saldoMedalhaExtra(alunoId) {
  const ganhas = await pool.query(
    `SELECT COUNT(*) AS total FROM progresso_missoes WHERE aluno_id = $1 AND extra1 = true`,
    [alunoId],
  );

  const usadas = await pool.query(
    `SELECT COALESCE(SUM(quantidade), 0) AS total FROM medalhas_extras_utilizadas WHERE aluno_id = $1`,
    [alunoId],
  );

  const total = Number(ganhas.rows[0].total) - Number(usadas.rows[0].total);
  return Math.max(total, 0); // nunca negativo, por segurança
}
async function saldosMedalhaExtraEmLote(idsAlunos) {
  if (idsAlunos.length === 0) return {};

  const ganhas = await pool.query(
    `SELECT aluno_id, COUNT(*) AS total
     FROM progresso_missoes
     WHERE extra1 = true AND aluno_id = ANY($1::int[])
     GROUP BY aluno_id`,
    [idsAlunos],
  );
  const usadas = await pool.query(
    `SELECT aluno_id, COALESCE(SUM(quantidade), 0) AS total
     FROM medalhas_extras_utilizadas
     WHERE aluno_id = ANY($1::int[])
     GROUP BY aluno_id`,
    [idsAlunos],
  );

  const mapaGanhas = {};
  ganhas.rows.forEach((r) => (mapaGanhas[r.aluno_id] = Number(r.total)));

  const mapaUsadas = {};
  usadas.rows.forEach((r) => (mapaUsadas[r.aluno_id] = Number(r.total)));

  const saldos = {};
  idsAlunos.forEach((id) => {
    const saldo = (mapaGanhas[id] || 0) - (mapaUsadas[id] || 0);
    saldos[id] = Math.max(saldo, 0);
  });

  return saldos;
}

app.get("/progresso/:alunoId", async (req, res) => {
  try {
    const alunoId = req.params.alunoId;
    let mesFiltro = req.query.mes || null;

    // Rank atual NUNCA filtra por mês — regra confirmada
    const aluno = await pool.query(
      `SELECT rank_atual, qtd_medalhas FROM alunos WHERE id = $1`,
      [alunoId],
    );

    if (!mesFiltro) {
      // Sem mês explícito: usa o mês mais recente com dados lançados
      const { meses_completos } = await statusMesesAluno(alunoId);
      mesFiltro = meses_completos[meses_completos.length - 1] || null;
    }

    let progresso = null;
    let resultados = null;

    if (mesFiltro) {
      const progressoQuery = await pool.query(
        `SELECT * FROM progresso_missoes WHERE aluno_id = $1 AND mes = $2`,
        [alunoId, mesFiltro],
      );
      const resultadosQuery = await pool.query(
        `SELECT * FROM resultados_mensais WHERE aluno_id = $1 AND mes = $2`,
        [alunoId, mesFiltro],
      );
      progresso = progressoQuery.rows[0] || null;
      resultados = resultadosQuery.rows[0] || null;
    }

    const saldoExtra = await saldoMedalhaExtra(alunoId);

    res.json({
      aluno: aluno.rows[0],
      progresso,
      resultados,
      mes: mesFiltro,
      saldo_medalha_extra: saldoExtra,
    });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: "Erro ao buscar progresso" });
  }
});
app.get("/aluno/meses/:alunoId", async (req, res) => {
  try {
    const alunoId = req.params.alunoId;
    const status = await statusMesesAluno(alunoId);
    res.json(status);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: "Erro ao buscar meses do aluno" });
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

    const saldo = await saldoMedalhaExtra(aluno_id);

    if (saldo <= 0) {
      return res.status(400).json({ erro: "Sem medalhas extras disponíveis" });
    }

    await pool.query(
      `INSERT INTO medalhas_extras_utilizadas (aluno_id, quantidade) VALUES ($1, $2)`,
      [aluno_id, 1],
    );

    const alunoAtual = await pool.query(
      `SELECT qtd_medalhas FROM alunos WHERE id = $1`,
      [aluno_id],
    );

    const totalMedalhas = Number(alunoAtual.rows[0].qtd_medalhas) + 1;
    const rank = calcularRank(totalMedalhas);

    await pool.query(
      `UPDATE alunos SET rank_atual = $1, qtd_medalhas = $2 WHERE id = $3`,
      [rank, totalMedalhas, aluno_id],
    );

    const novoSaldo = await saldoMedalhaExtra(aluno_id);

    res.json({
      mensagem: "Medalha usada com sucesso",
      saldo_restante: novoSaldo,
    });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: "Erro ao usar medalha extra" });
  }
});

// =====================
// ROTA: ESTATÍSTICAS DO COORDENADOR
// =====================
app.get("/coordenador/stats/:coordenadorId", async (req, res) => {
  try {
    const coordenadorId = req.params.coordenadorId;
    const timeFiltro = req.query.time || "Geral"; // Pega o parâmetro ?time=... da URL

    let queryAlunos = "";
    let params = [];

    // Lógica para montar a query SQL dependendo do filtro
    if (timeFiltro === "Geral" || timeFiltro === "") {
      // Se for Geral, busca TODOS os alunos do banco (independente do coordenador)
      queryAlunos = `SELECT id, rank_atual, qtd_medalhas, time FROM alunos`;
      params = []; // Não precisa de parâmetros
    } else {
      // Se for um time específico, busca apenas os alunos daquele time (independente do coordenador)
      queryAlunos = `SELECT id, rank_atual, qtd_medalhas, time FROM alunos WHERE time = $1`;
      params = [timeFiltro];
    }

    // 1. Contar total de alunos filtrados (Isso define o "Y" do slider e do gráfico)
    const totalQuery = await pool.query(
      `SELECT COUNT(*) as total FROM (${queryAlunos}) AS subquery`,
      params,
    );
    const totalAlunos = Number(totalQuery.rows[0].total);

    // 2. Buscar os alunos filtrados com seus ranks e medalhas
    const alunosQuery = await pool.query(queryAlunos, params);

    // 3. Calcular quantos alunos estão em cada rank exato
    const ranks = [
      "Bronze",
      "Prata",
      "Ouro",
      "Platina",
      "Diamante",
      "Mestre",
      "Lendário",
    ];
    let ranksExatos = {};
    ranks.forEach((r) => (ranksExatos[r] = 0));

    alunosQuery.rows.forEach((aluno) => {
      const rank = aluno.rank_atual || "Bronze";
      if (ranksExatos.hasOwnProperty(rank)) {
        ranksExatos[rank]++;
      }
    });

    res.json({
      total_alunos: totalAlunos,
      ranks_exatos: ranksExatos,
      time_selecionado: timeFiltro, // Opcional: útil para debug
    });
  } catch (erro) {
    console.error("Erro ao buscar stats:", erro);
    res.status(500).json({ erro: "Erro ao buscar estatísticas" });
  }
});

// =====================
// ROTA: VERIFICAR STATUS DO MÊS
// =====================
app.get("/coordenador/status-mes/:coordenadorId", async (req, res) => {
  try {
    const coordenadorId = req.params.coordenadorId;
    const mes = req.query.mes; // Ex: "Abril"

    if (!mes) {
      return res.status(400).json({ erro: "Mês não especificado" });
    }

    // 1. Conta quantos alunos o coordenador tem
    const totalAlunosQuery = await pool.query(
      `SELECT COUNT(*) as total FROM alunos WHERE coordenador_id = $1`,
      [coordenadorId],
    );
    const totalAlunos = Number(totalAlunosQuery.rows[0].total);

    // Se não tiver alunos, considera como "realizado" (vazio)
    if (totalAlunos === 0) {
      return res.json({ realizado: true });
    }

    // 2. Conta quantos alunos já têm lançamento para esse mês
    const lancamentosQuery = await pool.query(
      `
      SELECT COUNT(DISTINCT aluno_id) as total
      FROM resultados_mensais
      WHERE mes = $1
      AND aluno_id IN (SELECT id FROM alunos WHERE coordenador_id = $2)
      `,
      [mes, coordenadorId],
    );
    const lancamentos = Number(lancamentosQuery.rows[0].total);

    // 3. Se a quantidade de lançamentos for igual ao total de alunos, o mês está completo
    const realizado = lancamentos === totalAlunos;

    res.json({ realizado });
  } catch (erro) {
    console.error("Erro ao verificar status do mês:", erro);
    res.status(500).json({ erro: "Erro ao verificar status do mês" });
  }
});

// ── ROTA EXCLUSIVA PARA O SLIDER (BUSCA APENAS OS ALUNOS DO COORDENADOR) ──
app.get("/coordenador/alunos/:coordenadorId", async (req, res) => {
  try {
    const coordenadorId = req.params.coordenadorId;

    const resultado = await pool.query(
      `
      SELECT a.id, u.nome, a.rank_atual, a.qtd_medalhas, a.time
      FROM alunos a
      JOIN usuarios u ON a.usuario_id = u.id
      WHERE a.coordenador_id = $1
      ORDER BY u.nome
      `,
      [coordenadorId],
    );

    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: "Erro ao buscar alunos" });
  }
});

// =====================
// ROTA: STATUS DE TODOS OS MESES (fundação p/ filtro e lançamento)
// =====================
app.get("/coordenador/meses/:coordenadorId", async (req, res) => {
  try {
    const coordenadorId = req.params.coordenadorId;
    const status = await statusMeses(coordenadorId);
    res.json(status);
  } catch (erro) {
    console.error("Erro ao buscar status dos meses:", erro);
    res.status(500).json({ erro: "Erro ao buscar status dos meses" });
  }
});

// =====================
// ROTA: VERIFICAR STATUS DO MÊS PARA O COORDENADOR
// =====================
// app.get("/coordenador/status-mes/:coordenadorId", async (req, res) => {
//   try {
//     const coordenadorId = req.params.coordenadorId;
//     const mes = req.query.mes; // Ex: "Abril", "Mai"

//     if (!mes) {
//       return res.status(400).json({ erro: "Mês não especificado" });
//     }

//     // 1. Conta o total de alunos que este coordenador possui
//     const totalQuery = await pool.query(
//       `SELECT COUNT(*) as total FROM alunos WHERE coordenador_id = $1`,
//       [coordenadorId],
//     );
//     const totalAlunos = Number(totalQuery.rows[0].total);

//     // Se o coordenador não tiver alunos, consideramos o mês como concluído (vazio)
//     if (totalAlunos === 0) {
//       return res.json({ concluido: true });
//     }

//     // 2. Conta quantos alunos deste coordenador já têm dados lançados no mês solicitado
//     const lancamentosQuery = await pool.query(
//       `
//       SELECT COUNT(DISTINCT aluno_id) as total
//       FROM resultados_mensais
//       WHERE mes = $1
//       AND aluno_id IN (SELECT id FROM alunos WHERE coordenador_id = $2)
//       `,
//       [mes, coordenadorId],
//     );
//     const lancamentos = Number(lancamentosQuery.rows[0].total);

//     // 3. Verifica se a quantidade de lançamentos é igual ao total de alunos
//     const concluido = lancamentos === totalAlunos;

//     res.json({ concluido });
//   } catch (erro) {
//     console.error("Erro ao verificar status do mês:", erro);
//     res.status(500).json({ erro: "Erro ao verificar status do mês" });
//   }
// });

// =====================
// SERVIDOR
// =====================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
