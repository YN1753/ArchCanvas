package service

import (
	"archcanvas/internal/agent"
	"archcanvas/internal/dto"
	"archcanvas/internal/validator"
	"context"
	"errors"
	"strings"
)

func (s *ProjectService) GetAvailableModels(ctx context.Context, req dto.GetModelsReq) (agent.AvailableModels, error) {
	if s.ModelManager == nil {
		return agent.AvailableModels{}, errors.New("model manager is not initialized")
	}
	if s.isShowcaseActive(ctx) {
		if strings.TrimSpace(req.BaseURL) != "" || strings.TrimSpace(req.APIKey) != "" {
			return agent.AvailableModels{}, validator.NewForbiddenError("公开演示沙盒模式下禁止传入自定义 base_url 或 api_key 进行探测")
		}
		res, err := s.ModelManager.GetAvailableModels(ctx, dto.GetModelsReq{Provider: req.Provider})
		if err != nil {
			return agent.AvailableModels{}, err
		}
		// 脱敏剥离服务端内部 BaseURL，仅暴露预置模型标识
		for i := range res.Models {
			res.Models[i].BaseURL = ""
		}
		for i := range res.Providers {
			res.Providers[i].BaseURL = ""
		}
		return res, nil
	}
	return s.ModelManager.GetAvailableModels(ctx, req)
}

func (s *ProjectService) SaveModelConfig(ctx context.Context, req dto.SaveModelReq) (agent.AvailableModels, error) {
	if s.isShowcaseActive(ctx) {
		return agent.AvailableModels{}, validator.NewForbiddenError("公开演示沙盒模式下已锁定服务端模型配置，禁止修改默认模型与密钥")
	}
	if s.ModelManager == nil {
		return agent.AvailableModels{}, errors.New("model manager is not initialized")
	}
	return s.ModelManager.SaveAndSwitchModel(ctx, req)
}
