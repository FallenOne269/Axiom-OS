# AXIOM uses a bring-your-own-network model. Supply private_subnet_ids from a
# pre-existing VPC spanning at least two availability zones. This prevents the
# reference deployment from creating an unreviewed Internet gateway, NAT gateway,
# or broad ingress rules in a production account.

data "aws_subnet" "private" {
  for_each = toset(var.private_subnet_ids)
  id       = each.value
}
