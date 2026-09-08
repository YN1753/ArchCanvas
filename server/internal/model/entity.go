package model

type Entity struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (Entity) TableName() string { return "entities" }
