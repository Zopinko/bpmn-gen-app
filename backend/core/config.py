import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI


def get_openai_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")
    return OpenAI(api_key=api_key)


def apply_cors(app: FastAPI):
    # Preddefinované originy (lokálny dev + frontend na Renderi)
    default_origins = [
        "http://localhost:5173",
        "https://bpmn-gen-frontend.onrender.com",
    ]

    # Ak je nastavená premenná CORS_ALLOW_ORIGINS, použijeme ju, inak default
    origins = os.getenv("CORS_ALLOW_ORIGINS")
    if origins:
        allowed_origins = [o.strip() for o in origins.split(",") if o.strip()]
    else:
        allowed_origins = default_origins

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=False,  # daj True len ak chceš cookies/session z prehliadača
        allow_methods=["*"],
        allow_headers=["*"],
    )
