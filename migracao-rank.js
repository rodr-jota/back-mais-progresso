// migracao-rank.js — rodar uma única vez com `node migracao-rank.js`
const pool = require("./db");

function calcularRank(totalMedalhas) {
  const ranks = ["Bronze", "Prata", "Ouro", "Platina", "Diamante", "Mestre", "Lendário"];
  let indice = Math.floor(totalMedalhas / 3);
  if (indice > 6) indice = 6;
  return ranks[indice];
}

async function corrigirRanks() {
  const alunos = await pool.query("SELECT id, qtd_medalhas FROM alunos");

  for (const aluno of alunos.rows) {
    const rank = calcularRank(Number(aluno.qtd_medalhas));
    await pool.query("UPDATE alunos SET rank_atual = $1 WHERE id = $2", [
      rank,
      aluno.id,
    ]);
  }

  console.log("Ranks recalculados.");
  process.exit();
}

corrigirRanks();