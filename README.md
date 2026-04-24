# GCP Planner App

Aplicacao independente para planejamento inicial de pontos de controle em solo (GCPs) e checkpoints em projetos de aerofotogrametria com drones.

## Estrutura

- `frontend/`: interface React + Vite com mapa Leaflet e painel lateral.
- `backend/`: API Node.js + Express para calculo de pontos e exportacao.
- `articles/`: artigos copiados para fundamentacao da logica.
- `docs/`: notas tecnicas e decisoes de modelagem.
- `data/`: espaco reservado para bases futuras.
- `models/`: espaco reservado para modelos de regressao ou ML.

## Primeira entrega

- desenho de poligono no mapa
- calculo automatico de area
- painel de parametros
- sugestao inicial de GCPs e checkpoints
- visualizacao, arraste e exclusao de pontos
- exportacao em CSV, GeoJSON e KML

## Fundamentacao usada

Ver [docs/technical_basis.md](C:\meu_chatbot_flask - Copia\apps\gcp_planner_app\docs\technical_basis.md).
