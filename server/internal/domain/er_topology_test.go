package domain

import "testing"

func TestDetectJunctionTables_UnifiedRules(t *testing.T) {
	t.Run("detects join table with tenant_id audit column and 1 business column", func(t *testing.T) {
		design := &ERDesign{
			Entities: []Entity{
				{ID: "e_tenant", Name: "tenants", Attributes: []Attribute{{Name: "id", IsPrimaryKey: true}}},
				{ID: "e_user", Name: "users", Attributes: []Attribute{{Name: "id", IsPrimaryKey: true}}},
				{ID: "e_role", Name: "roles", Attributes: []Attribute{{Name: "id", IsPrimaryKey: true}}},
				{
					ID:   "e_ur",
					Name: "user_roles",
					Attributes: []Attribute{
						{Name: "id", IsPrimaryKey: true},
						{Name: "tenant_id"},
						{Name: "user_id"},
						{Name: "role_id"},
						{Name: "grant_scope"}, // 1 business payload column allowed
						{Name: "created_at"},
						{Name: "sort_order"},
					},
				},
			},
		}

		matches := DetectJunctionTables(design)
		if len(matches) != 1 {
			t.Fatalf("expected 1 junction table, got %d", len(matches))
		}
		if matches[0].Entity.Name != "user_roles" {
			t.Fatalf("expected user_roles, got %s", matches[0].Entity.Name)
		}
		pair := matches[0].LeftTarget.Name + ":" + matches[0].RightTarget.Name
		if pair != "users:roles" && pair != "roles:users" {
			t.Fatalf("expected M:N pair users:roles (ignoring tenant_id scope), got %s", pair)
		}
	})

	t.Run("rejects table with >= 2 business payload columns", func(t *testing.T) {
		design := &ERDesign{
			Entities: []Entity{
				{ID: "e_order", Name: "orders", Attributes: []Attribute{{Name: "id", IsPrimaryKey: true}}},
				{ID: "e_item", Name: "items", Attributes: []Attribute{{Name: "id", IsPrimaryKey: true}}},
				{
					ID:   "e_oi",
					Name: "order_items",
					Attributes: []Attribute{
						{Name: "id", IsPrimaryKey: true},
						{Name: "order_id"},
						{Name: "item_id"},
						{Name: "unit_price"},
						{Name: "quantity"},
					},
				},
			},
		}
		if got := DetectJunctionTables(design); len(got) != 0 {
			t.Fatalf("expected 0 junction tables when >=2 business columns exist, got %+v", got)
		}
	})

	t.Run("rejects candidate referenced as parent primary entity by another non-junction entity FK", func(t *testing.T) {
		design := &ERDesign{
			Entities: []Entity{
				{ID: "e_user", Name: "users", Attributes: []Attribute{{Name: "id", IsPrimaryKey: true}}},
				{ID: "e_role", Name: "roles", Attributes: []Attribute{{Name: "id", IsPrimaryKey: true}}},
				{
					ID:   "e_ur",
					Name: "user_roles",
					Attributes: []Attribute{
						{Name: "id", IsPrimaryKey: true},
						{Name: "user_id"},
						{Name: "role_id"},
					},
				},
				{
					ID:   "e_ur_log",
					Name: "grant_approvals",
					Attributes: []Attribute{
						{Name: "id", IsPrimaryKey: true},
						{Name: "user_role_id"},
						{Name: "approver_name"},
					},
				},
			},
		}
		if got := DetectJunctionTables(design); len(got) != 0 {
			t.Fatalf("expected user_roles to be excluded when referenced by grant_approvals.user_role_id, got %+v", got)
		}
	})
}

func TestEntityLookupAndCardinalityHelpers(t *testing.T) {
	d := &ERDesign{
		Entities: []Entity{
			{ID: "ent_1", Name: "warehouses"},
		},
	}
	lookup := d.EntityLookup()
	if _, ok := d.FindEntity("WAREHOUSES", lookup); !ok {
		t.Fatalf("expected case-insensitive FindEntity to locate warehouses")
	}

	r := Relation{RelationTypeID: "M:N"}
	if !r.IsManyToMany() || r.EffectiveCardinality() != "M:N" {
		t.Fatalf("expected M:N relation helpers to work, got %q", r.EffectiveCardinality())
	}
}
