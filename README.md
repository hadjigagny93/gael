# Gael

Application d'analyse de relevés bancaires — importez vos PDFs, catégorisez vos transactions et visualisez vos finances.

## Stack

- **Backend** : FastAPI + PostgreSQL + SQLAlchemy
- **Frontend** : React + Vite + Tailwind CSS + shadcn/ui + Recharts
- **Parser** : Service Python dédié à l'extraction des PDFs
- **Infra** : Docker Compose

## Lancer l'application

```bash
docker compose up --build
```

Accès :
- Frontend : http://localhost:5173
- API : http://localhost:8000
- Docs API : http://localhost:8000/docs

## Fonctionnalités

- Import de relevés bancaires PDF (multi-fichiers)
- Liste de transactions avec recherche et filtres par tag
- Gestion hiérarchique des tags
- Analytics : graphiques cumulés revenus/dépenses, pie chart, Sankey
- Thème clair/sombre
