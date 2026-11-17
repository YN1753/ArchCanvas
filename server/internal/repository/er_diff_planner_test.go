package repository

import (
	"testing"

	"archcanvas/internal/domain"
	"archcanvas/internal/model"
)

func TestPlanERDiff_PureInMemory(t *testing.T) {
	t.Run("preserves UUIDs on rename+recreate and cleans orphans", func(t *testing.T) {
		oldEntID := "01900000-0000-7000-8000-000000000010"
		orphanEntID := "01900000-0000-7000-8000-000000000099"
		oldAttrID := "01900000-0000-7000-8000-000000000020"

		oldEntities := []model.Entity{
			{ID: oldEntID, ProjectID: "proj_1", Name: "users"},
			{ID: orphanEntID, ProjectID: "proj_1", Name: "legacy_logs"},
		}
		oldAttrs := []model.Attribute{
			{ID: oldAttrID, EntityID: oldEntID, Name: "id", DBType: "BIGINT", IsPrimaryKey: true},
		}

		plan, err := planERDiff("proj_1", oldEntities, oldAttrs, nil, erTakenForeignUUIDs{}, domain.ERDesign{
			Entities: []domain.Entity{
				{
					ID:   oldEntID,
					Name: "accounts", // renamed from users
					Attributes: []domain.Attribute{
						{ID: oldAttrID, Name: "id", DBType: "BIGINT", IsPrimaryKey: true},
						{Name: "email", DBType: "VARCHAR(128)"},
					},
				},
				{
					ID:   "_temp_new_users",
					Name: "users", // brand-new table reusing old name
					Attributes: []domain.Attribute{
						{Name: "id", DBType: "BIGINT", IsPrimaryKey: true},
					},
				},
			},
			Relations: []domain.Relation{
				{SourceEntityID: "accounts", TargetEntityID: "_temp_new_users", Cardinality: "one_to_one"},
			},
		})
		if err != nil {
			t.Fatalf("planERDiff failed: %v", err)
		}

		if len(plan.EntitiesToUpdate) != 1 || plan.EntitiesToUpdate[0].ID != oldEntID || plan.EntitiesToUpdate[0].Name != "accounts" {
			t.Fatalf("expected oldEntID updated to accounts, got: %+v", plan.EntitiesToUpdate)
		}
		if len(plan.EntitiesToInsert) != 1 || plan.EntitiesToInsert[0].Name != "users" || plan.EntitiesToInsert[0].ID == oldEntID {
			t.Fatalf("expected new users entity inserted with fresh UUID, got: %+v", plan.EntitiesToInsert)
		}
		if len(plan.EntityDeleteIDs) != 1 || plan.EntityDeleteIDs[0] != orphanEntID {
			t.Fatalf("expected orphanEntID scheduled for deletion, got: %+v", plan.EntityDeleteIDs)
		}
		if len(plan.RelsToInsert) != 1 || plan.RelsToInsert[0].SourceEntityID != oldEntID || plan.RelsToInsert[0].TargetEntityID != plan.EntitiesToInsert[0].ID {
			t.Fatalf("expected relation endpoints remapped to canonical entity UUIDs, got: %+v", plan.RelsToInsert)
		}
	})

	t.Run("remints colliding cross-project UUIDs and rejects dangling relation endpoints", func(t *testing.T) {
		foreignEntUUID := "01900000-0000-7000-8000-000000000777"
		plan, err := planERDiff("proj_2", nil, nil, nil, erTakenForeignUUIDs{
			Entities: map[string]bool{foreignEntUUID: true},
		}, domain.ERDesign{
			Entities: []domain.Entity{
				{ID: foreignEntUUID, Name: "orders", Attributes: []domain.Attribute{{Name: "id", IsPrimaryKey: true}}},
			},
		})
		if err != nil {
			t.Fatalf("planERDiff failed: %v", err)
		}
		if len(plan.EntitiesToInsert) != 1 || plan.EntitiesToInsert[0].ID == foreignEntUUID {
			t.Fatalf("expected foreign colliding entity UUID reminted, got %+v", plan.EntitiesToInsert)
		}

		_, danglingErr := planERDiff("proj_2", nil, nil, nil, erTakenForeignUUIDs{}, domain.ERDesign{
			Entities: []domain.Entity{
				{Name: "orders", Attributes: []domain.Attribute{{Name: "id", IsPrimaryKey: true}}},
			},
			Relations: []domain.Relation{
				{SourceEntityID: "orders", TargetEntityID: "non_existent_table"},
			},
		})
		if danglingErr == nil {
			t.Fatal("expected validation error on dangling relation endpoint")
		}
	})
}
