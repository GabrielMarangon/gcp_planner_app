# Base Tecnica Inicial

## Artigos lidos

- `article_01.pdf`: Cho, Jeong e Lee (2026) sobre layout otimo de GCP para mapeamento 3D de alta precisao com UAV, RTK e PPK.
- `article_02.pdf`: Muradas Odriozola et al. (2024) sobre deteccao automatica de GCP em imagens de drone.
- `article_03.pdf`: Oliveira, Carvalho e Nero (2024) sobre georreferenciamento com ARP e aplicacao da Norma de Execucao 02/2018 e do MTGIR 2022 do INCRA.
- `article_04.pdf`: Sanz-Ablanedo et al. (2018) sobre efeito do numero e da distribuicao de GCP na acuracia de levantamentos UAV/SfM.

## Criterios praticos para a primeira versao

1. GCPs devem ocupar os cantos e manter distribuicao espacial equilibrada.
2. Acuracia nao deve ser avaliada apenas com GCPs; checkpoints independentes sao necessarios.
3. A quantidade de pontos deve crescer com area, relevo acidentado e exigencia de precisao.
4. A distribuicao interna deve complementar o perimetro com pontos no interior em forma de grade.
5. A arquitetura deve permitir evolucao futura para regras mais refinadas por GSD, RTK/PPK e normas do INCRA.

## Sinais importantes para a logica

- Cho et al. (2026) reportam que, para cenarios exigentes, uma referencia de `12 GCP/km2` com perimetro e interior ajuda a atingir metas rigorosas de RMSE.
- Sanz-Ablanedo et al. (2018) mostram que mais GCPs melhoram a acuracia, mas a distribuicao uniforme e tao importante quanto a quantidade.
- O estudo ligado ao INCRA reforca que GSD, geometria, relevo, RMS e checkpoints proporcionais a area devem entrar no raciocinio.
- O artigo de deteccao automatica de GCP indica uma trilha futura para apoio por visao computacional na identificacao de alvos.

## Decisoes de produto

- Sugerir sempre pontos nos cantos.
- Reservar um percentual configuravel de checkpoints.
- Gerar justificativa textual explicando impacto de area, relevo e precisao.
- Manter motor de regras isolado para futura substituicao por regressao ou ML.
