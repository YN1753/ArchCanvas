package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type HealthHandler struct {
	db *gorm.DB
}

func NewHealthHandler(db *gorm.DB) HealthHandler {
	return HealthHandler{db: db}
}

type HealthResponse struct {
	Status    string `json:"status"`   // "ok" | "degraded"
	Database  string `json:"database"` // "connected" | "disconnected"
	Timestamp string `json:"timestamp"`
}

func (h *HealthHandler) Check(c *gin.Context) {
	dbStatus := "connected"
	httpStatus := http.StatusOK
	overallStatus := "ok"

	if h.db != nil {
		sqlDB, err := h.db.DB()
		if err != nil || sqlDB.Ping() != nil {
			dbStatus = "disconnected"
			httpStatus = http.StatusServiceUnavailable
			overallStatus = "degraded"
		}
	}

	c.JSON(httpStatus, HealthResponse{
		Status:    overallStatus,
		Database:  dbStatus,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
}
