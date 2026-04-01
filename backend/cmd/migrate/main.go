package main

import (
	"context"
	"log"
	"os"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/joho/godotenv"
	"github.com/mobtgzhang/TexPad/backend/internal/config"
	appmigrations "github.com/mobtgzhang/TexPad/backend/migrations"
	"github.com/pressly/goose/v3"
)

func main() {
	_ = godotenv.Load("../../.env")
	_ = godotenv.Load("../.env")
	_ = godotenv.Load(".env")
	cfg := config.Load()
	pCfg, err := pgx.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("parse db url: %v", err)
	}
	db := stdlib.OpenDB(*pCfg)
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("ping db: %v", err)
	}
	goose.SetBaseFS(appmigrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		log.Fatal(err)
	}
	ctx := context.Background()
	if err := goose.UpContext(ctx, db, ".", goose.WithAllowMissing()); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	log.Println("migrations applied")
	os.Exit(0)
}
