package naming

import "testing"

func TestSingularize(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		// Compound snake_case & PascalCase preserving prefix
		{"user_roles", "user_role"},
		{"order_items", "order_item"},
		{"OrderItems", "order_item"},
		{"tenant_categories", "tenant_category"},
		{"role_permissions", "role_permission"},
		{"user_addresses", "user_address"},
		{"order_statuses", "order_status"},
		{"warehouse_inventories", "warehouse_inventory"},

		// Uncountables & singulars ending in 's'
		{"status", "status"},
		{"series", "series"},
		{"news", "news"},
		{"data", "data"},
		{"media", "media"},
		{"campus", "campus"},
		{"sms", "sms"},
		{"rbac", "rbac"},
		{"RBAC", "rbac"},
		{"address", "address"},
		{"access", "access"},
		{"process", "process"},
		{"business", "business"},

		// Irregulars
		{"people", "person"},
		{"person", "person"},
		{"children", "child"},
		{"men", "man"},
		{"women", "woman"},
		{"indices", "index"},
		{"indexes", "index"},
		{"matrices", "matrix"},
		{"vertices", "vertex"},
		{"leaves", "leaf"},
		{"lives", "life"},
		{"knives", "knife"},
		{"shelves", "shelf"},
		{"halves", "half"},

		// -ies -> -y & exceptions
		{"categories", "category"},
		{"companies", "company"},
		{"policies", "policy"},
		{"inventories", "inventory"},
		{"movies", "movie"},
		{"cookies", "cookie"},

		// -sses / -xes / -zes / -ches / -shes & -us/-as plurals stripping 'es'
		{"addresses", "address"},
		{"processes", "process"},
		{"businesses", "business"},
		{"accesses", "access"},
		{"boxes", "box"},
		{"quizzes", "quiz"},
		{"buzzes", "buzz"},
		{"batches", "batch"},
		{"dishes", "dish"},
		{"statuses", "status"},
		{"campuses", "campus"},
		{"bonuses", "bonus"},
		{"aliases", "alias"},
		{"canvases", "canvas"},

		// -ses / -ces words whose root ends in -se / -ce stripping only 's'
		{"warehouses", "warehouse"},
		{"invoices", "invoice"},
		{"releases", "release"},
		{"courses", "course"},
		{"licenses", "license"},
		{"cases", "case"},
		{"phases", "phase"},
		{"purchases", "purchase"},
		{"expenses", "expense"},
		{"responses", "response"},
		{"enterprises", "enterprise"},
		{"resources", "resource"},

		// Non-ASCII & empty
		{"", ""},
		{"   ", ""},
		{"用户档案", "用户档案"},
	}

	for _, tc := range tests {
		if got := Singularize(tc.input); got != tc.want {
			t.Errorf("Singularize(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestPluralizeAndPluralizeTable(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"User", "users"},
		{"users", "users"},
		{"OrderItem", "order_items"},
		{"order_items", "order_items"},
		{"Category", "categories"},
		{"Person", "people"},
		{"people", "people"},
		{"Child", "children"},
		{"Man", "men"},
		{"Woman", "women"},
		{"Matrix", "matrices"},
		{"Vertex", "vertices"},
		{"Leaf", "leaves"},
		{"Life", "lives"},
		{"Knife", "knives"},
		{"Shelf", "shelves"},
		{"Half", "halves"},
		{"Status", "statuses"},
		{"Address", "addresses"},
		{"Warehouse", "warehouses"},
		{"warehouses", "warehouses"},
		{"Movie", "movies"},
		{"Cookie", "cookies"},
		{"Series", "series"},
		{"Data", "data"},
		{"News", "news"},
		{"Media", "media"},
		{"SMS", "sms"},
		{"RBAC", "rbac"},
		{"用户", "用户"},
	}

	for _, tc := range tests {
		if got := Pluralize(tc.input); got != tc.want {
			t.Errorf("Pluralize(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}

	if got := PluralizeTable(""); got != "entities" {
		t.Errorf("PluralizeTable(\"\") = %q, want \"entities\"", got)
	}
}

func TestCaseConversions(t *testing.T) {
	snakeTests := []struct {
		in, want string
	}{
		{"OrderItem", "order_item"},
		{"userID", "user_id"},
		{"HTTPServer", "http_server"},
		{"ORDER_ITEMS", "order_items"},
		{"  user-roles.v2 ", "user_roles_v2"},
		{"", ""},
	}
	for _, tc := range snakeTests {
		if got := ToSnakeCase(tc.in); got != tc.want {
			t.Errorf("ToSnakeCase(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}

	pascalTests := []struct {
		in, want string
	}{
		{"user_id", "UserID"},
		{"http_url", "HTTPURL"},
		{"order_item", "OrderItem"},
		{"uuid", "UUID"},
		{"", ""},
	}
	for _, tc := range pascalTests {
		if got := ToPascalCase(tc.in); got != tc.want {
			t.Errorf("ToPascalCase(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}

	camelTests := []struct {
		in, want string
	}{
		{"id", "id"},
		{"id_2", "id2"},
		{"id_list", "idList"},
		{"user_id", "userID"},
		{"order_item", "orderItem"},
		{"", ""},
	}
	for _, tc := range camelTests {
		if got := ToCamelCase(tc.in); got != tc.want {
			t.Errorf("ToCamelCase(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
