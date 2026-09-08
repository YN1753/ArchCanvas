package domain

import "time"

type Project struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	Description  string       `json:"description"`
	Architecture Architecture `json:"architecture"`
	AIContext    AIContext    `json:"ai_context"`
	CreatedAt    time.Time    `json:"created_at"`
	UpdatedAt    time.Time    `json:"updated_at"`
}
